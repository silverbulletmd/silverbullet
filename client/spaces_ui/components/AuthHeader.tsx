export function AuthHeader({ logo }: { logo: string }) {
  return (
    <header class="sb-auth-header">
      <div class="sb-auth-brand">
        <img src={logo} alt="" />
        <span>SilverBullet</span>
      </div>
    </header>
  );
}
