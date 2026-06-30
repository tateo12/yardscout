import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Auth from './Auth.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Auth>
      {({ profile, signOut }) => <App profile={profile} signOut={signOut} />}
    </Auth>
  </StrictMode>,
)
