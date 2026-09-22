use axum::http::HeaderValue;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RequestedRange {
    Full,
    Partial { start: u64, end: u64 },
    Unsatisfiable,
}

pub(crate) fn parse_range_header(value: Option<&HeaderValue>, size: u64) -> RequestedRange {
    let parse_number = |value: &str| {
        value
            .bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| value.parse::<u64>().ok())
            .flatten()
    };
    let Some(value) = value.and_then(|value| value.to_str().ok()) else {
        return RequestedRange::Full;
    };
    let Some((unit, interval)) = value.split_once('=') else {
        return RequestedRange::Full;
    };
    if !unit.eq_ignore_ascii_case("bytes") || interval.contains(',') {
        return RequestedRange::Full;
    }
    let Some((start, end)) = interval.split_once('-') else {
        return RequestedRange::Full;
    };
    if end.contains('-') {
        return RequestedRange::Full;
    }

    if start.is_empty() {
        let Some(length) = parse_number(end) else {
            return RequestedRange::Full;
        };
        if length == 0 || size == 0 {
            return RequestedRange::Unsatisfiable;
        }
        return RequestedRange::Partial {
            start: size.saturating_sub(length),
            end: size - 1,
        };
    }

    let Some(start) = parse_number(start) else {
        return RequestedRange::Full;
    };
    let end = if end.is_empty() {
        None
    } else {
        let Some(end) = parse_number(end) else {
            return RequestedRange::Full;
        };
        Some(end)
    };
    if size == 0 || start >= size || end.is_some_and(|end| end < start) {
        return RequestedRange::Unsatisfiable;
    }
    RequestedRange::Partial {
        start,
        end: end.unwrap_or(size - 1).min(size - 1),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::{parse_range_header, RequestedRange};

    fn parse(value: &str, size: u64) -> RequestedRange {
        parse_range_header(Some(&HeaderValue::from_str(value).unwrap()), size)
    }

    #[test]
    fn parses_single_ranges() {
        assert_eq!(
            parse("bytes=0-3", 10),
            RequestedRange::Partial { start: 0, end: 3 }
        );
        assert_eq!(
            parse("bytes=7-", 10),
            RequestedRange::Partial { start: 7, end: 9 }
        );
        assert_eq!(
            parse("bytes=-4", 10),
            RequestedRange::Partial { start: 6, end: 9 }
        );
        assert_eq!(parse("bytes=10-12", 10), RequestedRange::Unsatisfiable);
        assert_eq!(parse("bytes=0-1,4-5", 10), RequestedRange::Full);
        assert_eq!(parse("items=0-1", 10), RequestedRange::Full);
    }

    #[test]
    fn resolves_range_boundaries() {
        assert_eq!(parse("bytes=0-0", 0), RequestedRange::Unsatisfiable);
        assert_eq!(parse("bytes=0-", 0), RequestedRange::Unsatisfiable);
        assert_eq!(parse("bytes=-1", 0), RequestedRange::Unsatisfiable);
        assert_eq!(parse("bytes=-0", 10), RequestedRange::Unsatisfiable);
        assert_eq!(parse("bytes=5-4", 10), RequestedRange::Unsatisfiable);
        assert_eq!(
            parse("bytes=7-99", 10),
            RequestedRange::Partial { start: 7, end: 9 }
        );
        assert_eq!(
            parse("bytes=-11", 10),
            RequestedRange::Partial { start: 0, end: 9 }
        );
    }

    #[test]
    fn malformed_ranges_fall_back_to_full() {
        let malformed = [
            "bytes=",
            "bytes=-",
            "bytes=abc-1",
            "bytes=0-abc",
            "bytes=--1",
            "bytes=+1-2",
            "bytes=0-1-2",
            "bytes= 0-1",
            "bytes=0 -1",
            " bytes=0-1",
            "bytes=18446744073709551616-",
            "bytes=0-18446744073709551616",
        ];
        for value in malformed {
            assert_eq!(parse(value, 10), RequestedRange::Full, "{value}");
        }
        assert_eq!(parse_range_header(None, 10), RequestedRange::Full);
    }
}
