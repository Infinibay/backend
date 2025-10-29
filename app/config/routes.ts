import { Express } from 'express'
import isoUploadRouter from '../routes/isoUpload'
import infiniserviceRouter from '../routes/infiniservice'
import scriptsRouter from '../routes/scripts'
import wallpapersRouter from '../routes/wallpapers'

export const configureRoutes = (app: Express): void => {
  // Add health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK')
  })

  // Mount the ISO upload router
  app.use('/isoUpload', isoUploadRouter)

  // Mount the InfiniService router for serving binaries and scripts
  app.use('/infiniservice', infiniserviceRouter)

  // Mount the scripts router for serving script content during first boot
  app.use('/scripts', scriptsRouter)

  // Mount the wallpapers API router - serves wallpapers from configured directory
  app.use('/api/wallpapers', wallpapersRouter)
}
