import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import BigBoard from './pages/BigBoard.jsx'
import Teams from './pages/Teams.jsx'
import TeamProfile from './pages/TeamProfile.jsx'
import PlayerProfile from './pages/PlayerProfile.jsx'
import Simulator from './pages/Simulator.jsx'
import UserSimulator from './pages/UserSimulator.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Big Board is the landing page — Overview removed in v0.21 */}
        <Route index element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BigBoard />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/teams/:teamId" element={<TeamProfile />} />
        <Route path="/players/:playerId" element={<PlayerProfile />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/simulator/user" element={<UserSimulator />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Route>
    </Routes>
  )
}
