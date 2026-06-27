import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { DebugApp } from './DebugApp'
import './styles.css'

const isDebug = new URLSearchParams(window.location.search).has('debug')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDebug ? <DebugApp /> : <App />}
  </React.StrictMode>,
)
