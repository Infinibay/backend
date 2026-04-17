# Express 4 — Referencia del Proyecto InfiniBay

> **Versión usada:** `express ^4.18.2` | **HTTP:** `node:http` | **Middleware clave:** `cors`, `body-parser`, `multer`, `connect-timeout`

## Descripción

Express es el framework HTTP subyacente que sirve como host para Apollo Server (GraphQL) y las rutas REST auxiliares. En InfiniBay, Express maneja:

1. **GraphQL** — Montado en `/graphql` via Apollo Server middleware
2. **REST API** — Rutas auxiliares para uploads, downloads y webhooks
3. **Static files** — Archivos estáticos desde `public/`
4. **Socket.io** — Comunicación realtime (comparte el mismo HTTP server)

## Configuración del Servidor

**Archivo:** `app/config/server.ts`

```typescript
export const configureServer = (app: Express, httpServer: Server): void => {
  configureSocketHandling(httpServer)  // Timeouts y logging de sockets TCP
  configureMiddleware(app)             // CORS, body-parser, static, timeout
}
```

### Middleware Registrados

| Orden | Middleware | Configuración |
|-------|-----------|---------------|
| 1 | `cors` | `origin`: `ALLOWED_ORIGINS` o `*`, `credentials: true`, `maxAge: 1h` |
| 2 | `express.static` | `public/`, cache 7 días, sin directory listing |
| 3 | `bodyParser.json` | Limit: 100GB (para uploads grandes) |
| 4 | `bodyParser.urlencoded` | Limit: 100GB, extended: true |
| 5 | `connect-timeout` | 1 hora global |
| 6 | Error handler | Captura `TimeoutError` → 408 |

### Socket Handling

```typescript
httpServer.on('connection', (socket) => {
  socket.setTimeout(ONE_HOUR_MS)  // 1 hora de timeout TCP
  socket.on('error', ...)         // Log de errores
  socket.on('close', ...)         // Log de desconexiones
  socket.on('timeout', () => socket.end())
})
```

## Rutas REST

**Archivo:** `app/config/routes.ts`

```typescript
app.get('/health', (req, res) => res.status(200).send('OK'))
app.use('/isoUpload', isoUploadRouter)         // Upload de ISOs via multer
app.use('/infiniservice', infiniserviceRouter)  // Servir binarios del guest agent
app.use('/scripts', scriptsRouter)              // Servir scripts para first-boot
app.use('/api/wallpapers', wallpapersRouter)    // API de wallpapers
```

### Ejemplo de Router REST: ISO Upload

**Archivo:** `app/routes/isoUpload.ts`

```typescript
const router = express.Router()

router.post('/',
  cors({ /* config específica */ }),
  (req, res, next) => {
    req.setTimeout(30 * 60 * 1000)  // 30 minutos para uploads grandes
    next()
  },
  adminAuthMiddleware,     // Verifica JWT y rol ADMIN
  upload.single('file'),   // Multer con storage custom
  async (req, res) => {
    // Procesar upload...
    res.status(200).json({ message: 'File uploaded successfully', isoId: iso.id })
  }
)
```

Patrones clave del router:
- **Middleware de auth**: `adminAuthMiddleware` verifica JWT antes de procesar
- **Timeout extendido**: Se aumenta el timeout para uploads grandes
- **Multer**: Storage con sufijo aleatorio para evitar colisiones
- **Validación de tipos**: Solo `.iso`, MIME types específicos
- **Cleanup**: Eliminación de archivos temporales en caso de error

## Flujo de Inicialización

**Archivo:** `app/index.ts`

```
bootstrap()
  │
  ├── const app = express()
  ├── const httpServer = http.createServer(app)   // Server compartido Express + Socket.io
  │
  ├── configureServer(app, httpServer)             // Middleware base
  ├── configureRoutes(app)                         // Rutas REST
  │
  ├── createApolloServer() + apolloServer.start()
  ├── app.use('/graphql', expressMiddleware(...))   // GraphQL endpoint
  │
  ├── createSocketService().initialize(httpServer)  // Socket.io en mismo server
  │
  └── httpServer.listen({ port, host })             // Escuchar en 0.0.0.0:4000
```

## Server Compartido (Express + Socket.io)

Express y Socket.io comparten el mismo servidor HTTP:

```typescript
const httpServer = http.createServer(app)          // Express usa este server
socketService.initialize(httpServer)                // Socket.io tambien lo usa
```

Esto permite que Socket.io escuche en el mismo puerto (4000) para conexiones WebSocket.

## Middleware de Autenticación

**Para rutas REST** (no GraphQL):

```typescript
import { adminAuthMiddleware } from '../middleware/adminAuth'
router.post('/upload', adminAuthMiddleware, handler)
```

**Para GraphQL**: La auth se maneja en el context builder de Apollo (`expressMiddleware`), no via middleware Express.

## Convenciones del Proyecto

1. **GraphQL es la API principal** — Las rutas REST son auxiliares para operaciones que no encajan en GraphQL (uploads binarios, servir archivos).
2. **Rutas REST con middleware propio** — Cada router importa su propio middleware de auth.
3. **Logs detallados** — Cada conexión/desconexión TCP se loguea con timestamp y remote address.
4. **Timeouts generosos** — 1 hora para requests normales, 30 minutos para uploads.
5. **CORS configurable** — Via `ALLOWED_ORIGINS` (comma-separated) o `*` por defecto.

## Variables de Entorno Relevantes

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `4000` | Puerto del servidor |
| `ALLOWED_ORIGINS` | `*` | Origins CORS (comma-separated) |
| `INFINIBAY_BASE_DIR` | `/opt/infinibay` | Directorio base para ISOs y archivos |
| `INFINIBAY_ISO_DIR` | — | Directorio de ISOs |
| `FRONTEND_URL` | `*` | URL del frontend para CORS |
| `NODE_ENV` | `development` | Entorno (afecta auth debug) |
