import { Express } from 'express'
import isoUploadRouter from '../routes/isoUpload'

export const configureRoutes = (app: Express): void => {
  // Add health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK')
  })

  // Mount the ISO upload router
  app.use('/isoUpload', isoUploadRouter)
}
