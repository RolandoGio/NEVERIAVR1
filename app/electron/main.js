import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { startApiServer } from './api.js'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV !== 'production'

async function createWindow () {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  await startApiServer(8787)
  await createWindow()
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
