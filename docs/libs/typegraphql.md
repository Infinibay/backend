# TypeGraphQL — Referencia del Proyecto InfiniBay

> **Versión usada:** `type-graphql ^2.0.0-beta.3` | **Peer:** `graphql ^16.8.1` | **Requiere:** `reflect-metadata ^0.2.1`

## Descripción

TypeGraphQL es un framework que permite definir esquemas GraphQL usando clases y decoradores de TypeScript, eliminando la necesidad de mantener esquemas SDL manuales. En InfiniBay, el esquema se genera automáticamente desde las clases decoradas y se emite a `app/schema.graphql` (~49KB).

## Configuración del Esquema

**Archivo:** `app/config/apollo.ts`

```typescript
import { buildSchema } from 'type-graphql'
import resolvers from '../graphql/resolvers'
import { authChecker } from '../utils/authChecker'

const schema = await buildSchema({
  resolvers,                              // Array de clases resolver (26 registradas)
  emitSchemaFile: path.resolve(__dirname, '../schema.graphql'),
  authChecker                             // Función global de autorización
})
```

### Requisito previo

`reflect-metadata` debe importarse **antes** de cualquier decorador. Esto se hace en `app/index.ts`:

```typescript
import 'reflect-metadata'
```

## Decoradores Principales

### Definir Tipos de Objeto (Object Types)

**Archivo:** `app/graphql/types/AppSettingsType.ts`

```typescript
import { ObjectType, Field, ID, InputType } from 'type-graphql'

@ObjectType()
export class AppSettings {
  @Field(() => ID)
  id!: string

  @Field()
  theme!: string

  @Field(() => String, { nullable: true })
  logoUrl?: string | null

  @Field()
  createdAt!: Date
}

@InputType()
export class AppSettingsInput {
  @Field(() => String, { nullable: true })
  theme?: string
}
```

### Definir Resolvers

**Archivo:** `app/graphql/resolvers/AppSettingsResolver.ts`

```typescript
import { Resolver, Query, Mutation, Arg, Authorized, Ctx } from 'type-graphql'

@Resolver()
export class AppSettingsResolver {
  @Query(() => AppSettings)
  @Authorized('USER')
  async getAppSettings(@Ctx() { prisma }: InfinibayContext): Promise<AppSettings> {
    const service = new AppSettingsService(prisma)
    return service.getAppSettings()
  }

  @Mutation(() => AppSettings)
  @Authorized('ADMIN')
  async updateAppSettings(
    @Arg('input') input: AppSettingsInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<AppSettings> {
    const service = new AppSettingsService(prisma)
    return service.updateAppSettings(input)
  }
}
```

## Patrones del Proyecto

### 1. Separación Queries/Mutations

Algunos resolvers dividen Queries y Mutations en clases separadas:

```typescript
// En resolvers/index.ts:
import { MachineMutations, MachineQueries } from './machine/resolver'
import { ApplicationQueries, ApplicationMutations } from './application/resolver'
```

### 2. Context Tipado (`InfinibayContext`)

**Archivo:** `app/utils/context.ts`

Todos los resolvers reciben un contexto tipado:

```typescript
export interface InfinibayContext {
  req: Request
  res: Response
  user: SafeUser | null        // Omit<User, 'password' | 'token'>
  prisma: PrismaClient
  setupMode: boolean
  virtioSocketWatcher?: VirtioSocketWatcherService
  auth?: AuthenticationMetadata
  userHelpers?: UserValidationHelpers
}
```

Uso típico con destructuring:

```typescript
@Ctx() { prisma, user }: InfinibayContext
@Ctx() { prisma, user, userHelpers }: InfinibayContext
```

### 3. Autorización por Roles

**Archivo:** `app/utils/authChecker.ts`

El `authChecker` global soporta 4 roles:

| Decorador | Roles permitidos | Descripción |
|-----------|------------------|-------------|
| `@Authorized('USER')` | USER, ADMIN, SUPER_ADMIN | Cualquier usuario autenticado |
| `@Authorized('ADMIN')` | ADMIN, SUPER_ADMIN | Solo administradores |
| `@Authorized('SETUP_MODE')` | — | Solo cuando `setupMode === true` |

El flujo de autorización:
1. Verifica si `context.user` ya existe (inyectado en `index.ts` via JWT)
2. Si no, intenta fallback verificando el token JWT desde `context.req`
3. Valida que el `userId` y `role` del token coincidan con el usuario de DB

### 4. Registro de Resolvers

**Archivo:** `app/graphql/resolvers/index.ts`

Todos los resolvers se registran como `NonEmptyArray<Function>`:

```typescript
const resolvers: NonEmptyArray<Function> = [
  UserResolver,
  MachineQueries, MachineMutations,
  SetupResolver,
  // ... 26 resolvers en total
]
```

### 5. Tipos auxiliares compartidos

Los tipos GraphQL que no pertenecen a un resolver específico se registran en `app/graphql/types/`:

- `RecommendationTypes.ts` — 7 clases (VMRecommendationType, RecommendationFilterInput, etc.)
- `AppSettingsType.ts` — ObjectType + InputType

Estos archivos se importan indirectamente para que `buildSchema` los detecte.

## Decoradores — Referencia Rápida

| Decorador | Uso | Ejemplo |
|-----------|-----|---------|
| `@ObjectType()` | Definir tipo GraphQL | `@ObjectType() class AppSettings { ... }` |
| `@InputType()` | Definir tipo de input para mutations | `@InputType() class AppSettingsInput { ... }` |
| `@Field(() => Type)` | Declarar campo en tipo | `@Field(() => ID) id!: string` |
| `@Resolver()` | Declarar clase resolver | `@Resolver() class AppSettingsResolver { ... }` |
| `@Query(() => Type)` | Declarar query | `@Query(() => [Machine]) async machines() { ... }` |
| `@Mutation(() => Type)` | Declarar mutation | `@Mutation(() => Machine) async createMachine() { ... }` |
| `@Arg('name')` | Parámetro de query/mutation | `@Arg('id') id: string` |
| `@Ctx()` | Inyectar contexto | `@Ctx() { prisma }: InfinibayContext` |
| `@Authorized(role)` | Proteger resolver | `@Authorized('ADMIN')` |
| `@FieldResolver()` | Resolver campo computado | `@FieldResolver() fullName() { ... }` |

## Estructura de Archivos

```
app/graphql/
├── resolvers/
│   ├── index.ts               # Registro de todos los resolvers
│   ├── AppSettingsResolver.ts  # Ejemplo canónico de resolver
│   ├── machine/resolver.ts     # Queries + Mutations separadas
│   ├── user/resolver.ts
│   ├── firewall/resolver.ts
│   ├── scripts/resolver.ts
│   ├── health/
│   ├── application/
│   └── ...                    # 26 resolvers en total
├── types/
│   ├── AppSettingsType.ts      # ObjectType + InputType
│   ├── RecommendationTypes.ts  # 7 clases de tipos auxiliares
│   └── ...
└── utils/                      # Utilidades GraphQL
```

## Notas Importantes

- **No editar `schema.graphql` manualmente** — se regenera en cada build via `emitSchemaFile`.
- **Importar tipos auxiliares** en `resolvers/index.ts` o en el resolver que los usa para que TypeGraphQL los registre.
- **El patrón de proyecto** es: Resolver (thin) → Service (lógica) → Prisma (datos). Los resolvers nunca deben contener lógica de negocio.
- **Module aliases**: Usar `@services`, `@graphql`, `@utils`, `@resolvers` para imports (definidos en `package.json._moduleAliases`).
