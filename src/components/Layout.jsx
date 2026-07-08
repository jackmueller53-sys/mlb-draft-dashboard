import { NavLink, Outlet, Link } from 'react-router-dom'

const NAV = [
  { to: '/',               label: 'Overview',  end: true },
  { to: '/board',          label: 'Big Board' },
  { to: '/teams',          label: 'Teams' },
  { to: '/simulator',      label: 'Simulator', end: true },
  { to: '/simulator/user', label: 'Draft as GM' },
]

export default function Layout() {
  return (
    <>
      <header className="hub-header">
        <div className="hub-hdr">
          <Link to="/" className="hub-logo">
            <div className="hub-logo-mark">D</div>
            <div>
              <span className="hub-logo-title">Draft Dashboard</span>
              <span className="hub-logo-sub">2026 MLB Draft</span>
            </div>
          </Link>
          <div className="hub-divider" />
          <nav className="hub-nav">
            {NAV.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `hub-tab ${isActive ? 'active' : ''}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hub-spacer" />
          <span className="hub-meta">v0.7 · FO model · R1+R2 training data</span>
        </div>
      </header>
      <main className="page-wrap">
        <Outlet />
      </main>
    </>
  )
}
