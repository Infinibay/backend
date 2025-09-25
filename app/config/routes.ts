import { Express } from 'express'
import isoUploadRouter from '../routes/isoUpload'
import infiniserviceRouter from '../routes/infiniservice'
import wallpapersRouter from '../routes/wallpapers'
import avatarsRouter from '../routes/avatars'

export const configureRoutes = (app: Express): void => {
  // Add health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK')
  })

  // Mount the ISO upload router
  app.use('/isoUpload', isoUploadRouter)

  // Mount the InfiniService router for serving binaries and scripts
  app.use('/infiniservice', infiniserviceRouter)

  // Mount the wallpapers API router - serves wallpapers from configured directory
  app.use('/api/wallpapers', wallpapersRouter)

  // Mount the avatars API router - serves avatar list from public/images/avatars/
  app.use('/api/avatars', avatarsRouter)
}
