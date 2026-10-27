export function HeroVisual() {
  return (
    <div className="hero-stage" role="img" aria-label="A scan pulse moving across a wireframe of a web page">
      <p className="hero-chip hero-chip-a">Leaked keys</p>
      <p className="hero-chip hero-chip-b">Open databases</p>
      <div className="hero-radar">
        <div className="hero-ring" aria-hidden="true" />
        <div className="hero-sweep" aria-hidden="true" />
        <div className="hero-browser">
          <div className="hero-browser-bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="hero-wire" aria-hidden="true">
            <span className="hero-wire-title" />
            <span className="hero-wire-line" />
            <span className="hero-wire-line short" />
            <span className="hero-wire-cards">
              <i />
              <i />
              <i />
            </span>
          </div>
          <p className="hero-caption">Read-only checks on an origin you own</p>
        </div>
      </div>
      <p className="hero-chip hero-chip-c">Missing auth</p>
      <p className="hero-chip hero-chip-d">Header gaps</p>
    </div>
  );
}
