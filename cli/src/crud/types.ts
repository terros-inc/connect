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

export type ObjectSchema = SchemaBase & {
  type: 'object'
  properties: {
    [key: string]: Schema
  }
  required?: string[]
}

export type UnionSchema = SchemaBase & {
  oneOf: Schema[]
}

export type ArraySchema = SchemaBase & {
  type: 'array'
  items: Schema
}

export type TupleSchema = SchemaBase & {
  type: 'array'
  prefixItems: Schema[]
}

export type Schema =
  | RefSchema
  | StringSchema
  | IntegerSchema
  | NumberSchema
  | BooleanSchema
  | ObjectSchema
  | UnionSchema
  | ArraySchema
  | TupleSchema

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
