//! Outbound fetch guard for client metadata documents: a DNS resolver that
//! only hands public addresses to the connector, so a hostname cannot point
//! the server at its own network (SSRF).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => is_public_v6(v6),
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || (a == 100 && (b & 0xc0) == 64)
        || (a == 192 && b == 0 && c == 0)
        || ip.is_documentation()
        || (a == 198 && (b & 0xfe) == 18)
        || ip.is_multicast()
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_public_v4(v4);
    }
    let s = ip.segments();
    // Only global unicast (2000::/3) is reachable on the public internet;
    // this also rules out loopback, unspecified, unique-local, link-local,
    // multicast and the NAT64 and IPv4-compatible forms.
    if s[0] & 0xe000 != 0x2000 {
        return false;
    }
    match s[0] {
        // Teredo, benchmarking and documentation
        0x2001 if s[1] == 0 || s[1] == 2 || s[1] == 0x0db8 => false,
        // 6to4 embeds an IPv4 address that decides where it goes
        0x2002 => is_public_v4(Ipv4Addr::new(
            (s[1] >> 8) as u8,
            s[1] as u8,
            (s[2] >> 8) as u8,
            s[2] as u8,
        )),
        _ => true,
    }
}

/// Resolves with the system resolver and fails unless every address is
/// public. An
/// IP-literal URL host never reaches a resolver, so callers must check those
/// themselves (`validate_cimd_url` does).
#[derive(Clone, Debug, Default)]
pub struct PublicOnlyResolver {
    allow_loopback: bool,
}

impl PublicOnlyResolver {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub fn allowing_loopback() -> Self {
        Self {
            allow_loopback: true,
        }
    }
}

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let allow_loopback = self.allow_loopback;
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            let addrs = only_public(&host, addrs, allow_loopback)?;
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// Refuses the whole name when any address is non-public, rather than
/// dialing the public ones: a name that also points inward is not one the
/// server should be fetching from.
fn only_public(
    host: &str,
    addrs: Vec<SocketAddr>,
    allow_loopback: bool,
) -> Result<Vec<SocketAddr>, Box<dyn std::error::Error + Send + Sync>> {
    if addrs.is_empty() {
        return Err(format!("{host} did not resolve").into());
    }
    let allowed = |ip: IpAddr| is_public_ip(ip) || (allow_loopback && ip.is_loopback());
    if !addrs.iter().all(|addr| allowed(addr.ip())) {
        return Err(format!("{host} resolves to a non-public address").into());
    }
    Ok(addrs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_public_ip_table() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "224.0.0.1",
            "192.0.2.1",
            "::",
            "ff02::1",
            "2001:db8::1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2002:7f00:1::1",
            "255.255.255.255",
            "198.18.0.1",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "1.1.1.1",
            "2606:4700:4700::1111",
            "::ffff:1.1.1.1",
            "100.128.0.1",
            "2002:101:101::1",
        ] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn mixed_resolution_is_refused() {
        let addr = |s: &str| SocketAddr::new(s.parse().unwrap(), 0);
        let public = vec![addr("1.1.1.1"), addr("2606:4700:4700::1111")];
        assert_eq!(
            only_public("client.example", public.clone(), false).unwrap(),
            public
        );
        let mixed = vec![addr("1.1.1.1"), addr("10.0.0.5")];
        assert!(only_public("client.example", mixed, false).is_err());
        let mixed = vec![addr("127.0.0.1"), addr("1.1.1.1")];
        assert!(only_public("client.example", mixed.clone(), false).is_err());
        assert!(only_public("client.example", mixed, true).is_ok());
        let private_with_loopback = vec![addr("127.0.0.1"), addr("192.168.1.1")];
        assert!(only_public("client.example", private_with_loopback, true).is_err());
        assert!(only_public("client.example", vec![], true).is_err());
    }

    #[tokio::test]
    async fn resolver_refuses_loopback() {
        let name: Name = "localhost".parse().unwrap();
        assert!(PublicOnlyResolver::new().resolve(name).await.is_err());
        let name: Name = "localhost".parse().unwrap();
        let addrs: Vec<_> = PublicOnlyResolver::allowing_loopback()
            .resolve(name)
            .await
            .unwrap()
            .collect();
        assert!(!addrs.is_empty());
    }
}
