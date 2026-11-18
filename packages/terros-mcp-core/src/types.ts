export type SchemaBase = {
  title?: string
  description?: string
  deprecated?: boolean
}

export type RefSchema = SchemaBase & {
  $ref: string
}

export type StringSchema = SchemaBase & {
  type: 'string'
  enum?: string[]
  pattern?: string
  example?: string
}

export type IntegerSchema = SchemaBase & {
  type: 'integer'
  minimum?: number
  maximum?: number
  example?: number
}

export type NumberSchema = SchemaBase & {
  type: 'number'
  minimum?: number
  maximum?: number
  example?: number
}
export type BooleanSchema = SchemaBase & {
  type: 'boolean'
}

export type NullSchema = SchemaBase & {
  type: 'null'
}

export type ObjectSchema = SchemaBase & {
  type: 'object'
  properties?: {
    [key: string]: Schema
  }
  additionalProperties?: Schema
  required?: string[]
  /** Further constraints on the same object; its own properties count as one more member. */
  allOf?: Schema[]
}

export type UnionSchema = SchemaBase & {
  oneOf: Schema[]
}

export type AllOfSchema = SchemaBase & {
  allOf: Schema[]
}

export type ArraySchema = SchemaBase & {
  type: 'array'
  items: Schema
}

export type TupleSchema = SchemaBase & {
  type: 'array'
  prefixItems: Schema[]
}

/** OpenAPI 3.1 writes a nullable scalar as a list of types, such as `type: ['string', 'null']`. */
export type TypeListSchema = SchemaBase & {
  type: ('string' | 'integer' | 'number' | 'boolean' | 'null')[]
}

export type Schema =
  | RefSchema
  | StringSchema
  | IntegerSchema
  | NumberSchema
  | BooleanSchema
  | NullSchema
  | ObjectSchema
  | UnionSchema
  | AllOfSchema
  | ArraySchema
  | TupleSchema
  | TypeListSchema

export type OpenAPISchema = {
  /**
   * OpenAPI Schema version`
   */
  openapi: string
  info: {
    title: string
    version: string
    termsOfService: string
    contact: {
      email: string
      url: string
    }
    description: string
  }
  servers: [
    {
      description: string
      url: string
    },
  ]
  paths: {
    [path: string]: {
      post: {
        operationId: string
        summary: string
        tags: string[]
        description: string
        requestBody: {
          content: {
            'application/json': {
              schema: Schema
              example?: unknown
              examples?: { [name: string]: { value?: unknown } }
            }
          }
        }
      }
    }
  }
  components: {
    schemas: {
      [name: string]: Schema
    }
  }
}
