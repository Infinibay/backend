# Apollo Server 4 — Referencia del Proyecto InfiniBay

> **Versión usada:** `@apollo/server ^4.3.0` | **Integración:** Express 4 via `expressMiddleware`

## Descripción

Apollo Server es el servidor GraphQL que procesa las queries/mutations. En InfiniBay se usa Apollo Server 4 con la integración Express (`@apollo/server/express4`), montado en la ruta `/graphql`.

## Configuración

**Archivo:** `app/config/apollo.ts`

```typescript
import { ApolloServer } from '@apollo/server'
import { GraphQLError } from 'graphql'
import { buildSchema } from 'type-graphql'

export const createApolloServer = async (): Promise<ApolloServer> => {
  const schema = await buildSchema({
    resolvers,
    emitSchemaFile: path.resolve(__dirname, '../schema.graphql'),
    authChecker
  })

  return new ApolloServer({
    schema,
    csrfPrevention: true,
    cache: 'bounded',
    plugins: [],
    formatError: (error: any): GraphQLError => {
      logger.error(error)

      // Mapeo de códigos de error personalizados
      if (error?.extensions?.code === 'UNAUTHORIZED') {
        return new GraphQLError('Not authorized', {
          extensions: { code: 'UNAUTHORIZED' }
        })
      }
      if (error?.extensions?.code === 'FORBIDDEN') {
        return new GraphQLError('Access denied', {
          extensions: { code: 'FORBIDDEN' }
        })
      }
      if (error?.extensions?.code === 'NOT_FOUND') {
        return new GraphQLError('Resource not found', {
          extensions: { code: 'NOT_FOUND' }
        })
      }
      return error
    }
  })
}
```

## Montaje en Express

**Archivo:** `app/index.ts`

```typescript
import { expressMiddleware } from '@apollo/server/express4'

const apolloServer = await createApolloServer()
await apolloServer.start()

app.use(
  '/graphql',
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
  }),
  expressMiddleware(apolloServer, {
    context: async ({ req, res }): Promise<InfinibayContext> => {
      const authResult = await verifyRequestAuth(req, {
        method: 'context',
        debugAuth: process.env.DEBUG_AUTH === '1' || process.env.NODE_ENV !== 'production'
      })

      return {
        prisma,
        req,
        res,
        user: authResult.user,           // SafeUser | null
        setupMode: false,
        virtioSocketWatcher,
        auth: authResult.meta,           // AuthenticationMetadata
        userHelpers: createUserValidationHelpers(authResult.user, authResult.meta)
      }
    }
  })
)
```

## Flujo de Contexto

El contexto Apollo se construye **por cada request** y sigue este flujo:

```
Request HTTP
  │
  ├── CORS middleware (origins, credentials)
  │
  ├── expressMiddleware context builder:
  │     ├── verifyRequestAuth() → verifica JWT del header Authorization
  │     ├── Busca usuario en DB via Prisma
  │     ├── Crea AuthenticationMetadata (método, status, warnings)
  │     └── Crea UserValidationHelpers (isAuthenticated, hasRole, isAdmin)
  │
  └── InfinibayContext disponible en todos los resolvers
        ├── prisma: PrismaClient
        ├── user: SafeUser | null
        ├── auth: AuthenticationMetadata
        ├── userHelpers: UserValidationHelpers
        ├── req: Express.Request
        ├── res: Express.Response
        ├── setupMode: boolean
        └── virtioSocketWatcher: VirtioSocketWatcherService
```

## Manejo de Errores

### Códigos de Error GraphQL

| Código | HTTP Status | Descripción |
|--------|------------|-------------|
| `UNAUTHORIZED` | 200 (GraphQL) | Token inválido o ausente |
| `FORBIDDEN` | 200 (GraphQL) | Sin permisos para la operación |
| `NOT_FOUND` | 200 (GraphQL) | Recurso no encontrado |

### Formato de Error Personalizado

Los resolvers lanzan errores con extensiones:

```typescript
throw new GraphQLError('Access denied! You don\'t have permission for this action!', {
  extensions: { code: 'FORBIDDEN' }
})
```

El `formatError` los normaliza antes de enviar al cliente.

## Opciones de Configuración

| Opción | Valor | Descripción |
|--------|-------|-------------|
| `csrfPrevention` | `true` | Previene ataques CSRF en POST requests |
| `cache` | `'bounded'` | Cache en memoria con límite de tamaño |
| `plugins` | `[]` | Sin plugins adicionales (se pueden agregar Apollo Studio, tracing, etc.) |
| `schema` | buildSchema() | Esquema generado por TypeGraphQL |

## Ciclo de Vida del Servidor

```
bootstrap()
  │
  ├── createApolloServer() → buildSchema + new ApolloServer()
  ├── apolloServer.start() → Inicializa el servidor
  ├── expressMiddleware() → Monta en Express en /graphql
  │
  └── shutdown()
        └── httpServer.close() → Cierra conexiones (Apollo se detiene automáticamente)
```

## Convenciones del Proyecto

1. **Un solo endpoint GraphQL**: Todas las operaciones pasan por `POST /graphql`.
2. **Auth en context**: La autenticación se resuelve al construir el contexto, no en cada resolver.
3. **Fallback en authChecker**: Si el contexto no tiene usuario, `authChecker.ts` intenta verificar el token como fallback.
4. **Debug mode**: Activar con `DEBUG_AUTH=1` o automáticamente en desarrollo (`NODE_ENV !== 'production'`).
5. **Variables relevantes**: `ALLOWED_ORIGINS` (CORS), `TOKENKEY` (JWT secret), `PORT` (default 4000).

## Dependencias Relacionadas

- `graphql ^16.8.1` — Runtime GraphQL core
- `graphql-scalars ^1.22.4` — Tipos escalares personalizados (DateTime, JSON, etc.)
- `graphql-upload ^16.0.2` — Upload de archivos via GraphQL
- `type-graphql ^2.0.0-beta.3` — Define el schema via decoradores TypeScript
- `dataloader ^2.2.3` — Batch loading para evitar N+1 queries
