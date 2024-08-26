import { Project, SourceFile, Statement, SyntaxKind, ts } from 'ts-morph';
import { camelCase, constantCase } from 'change-case';
import { match, P } from 'ts-pattern';
import {
  cleanRefName,
  GeneratedClientFunction,
  GeneratedImportPath,
  GeneratedSchema,
  getFullGRPCName,
  getImportPath,
  getObjectProperties,
  Optional,
  ParsedAuthType,
  ParsedObject,
  ParsedObjectProperty,
  ParsedSchemaWithRef,
  PluginBase,
  PluginConfig,
  PluginFile,
  PluginFileGeneratorConfig,
  PluginFilePostBuildHook,
  PluginFileReader,
} from '@pentops/jsonapi-jdef-ts-generator';
import { createLogicalAndChain, findMatchingVariableStatement } from './helpers';
import { buildPreload } from './preload';

const { factory } = ts;

export const pluginFileReader: PluginFileReader<SourceFile> = async (filePath) => {
  try {
    return new Project({ useInMemoryFileSystem: true }).addSourceFileAtPath(filePath);
  } catch {
    return undefined;
  }
};

type EntityReferenceDetail = { entity: NormalizerEntity; isArray: boolean };
type EntityReference = EntityReferenceDetail | { isArray: boolean; schema: Map<string, EntityReference> };

const optionalQuestionToken = factory.createToken(SyntaxKind.QuestionToken);

export const J5_LIST_PAGE_RESPONSE_TYPE = 'j5.list.v1.PageResponse';
export const J5_LIST_PAGE_REQUEST_TYPE = 'j5.list.v1.PageRequest';
export const J5_LIST_PAGE_REQUEST_PAGINATION_TOKEN_PARAM_NAME = 'token';
export const J5_LIST_PAGE_RESPONSE_PAGINATION_TOKEN_PARAM_NAME = 'nextToken';

export const REACT_QUERY_IMPORT_PATH = '@tanstack/react-query';
export const REACT_QUERY_MUTATION_HOOK_NAME = 'useMutation';
export const REACT_QUERY_QUERY_HOOK_NAME = 'useQuery';
export const REACT_QUERY_INFINITE_QUERY_HOOK_NAME = 'useInfiniteQuery';
export const REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME = 'pageParam';
export const REACT_QUERY_META_PARAM_NAME = 'meta';
export const REACT_QUERY_ENABLED_PARAM_NAME = 'enabled';
export const REACT_QUERY_INFINITE_QUERY_INITIAL_PAGE_PARAM_NAME = 'initialPageParam';
export const REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_PARAM_NAME = 'getNextPageParam';
export const REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_FN_RESPONSE_PARAM_NAME = 'response';
export const REACT_QUERY_INFINITE_DATA_TYPE_NAME = 'InfiniteData';
export const REACT_QUERY_QUERY_KEY_TYPE_NAME = 'QueryKey';

type ReactQueryHookName = typeof REACT_QUERY_QUERY_HOOK_NAME | typeof REACT_QUERY_MUTATION_HOOK_NAME | typeof REACT_QUERY_INFINITE_QUERY_HOOK_NAME;

const REACT_QUERY_OPTIONS_TYPE_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'UseQueryOptions',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'UseMutationOptions',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'UseInfiniteQueryOptions',
};

const REACT_QUERY_FN_KEY_PARAMETER_NAME_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'queryKey',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'queryKey',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'mutationKey',
};

const REACT_QUERY_FN_PARAMETER_NAME_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'queryFn',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'queryFn',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'mutationFn',
};

export const NORMALIZR_IMPORT_PATH = 'normalizr';
export const NORMALIZR_SCHEMA_NAME = 'schema';
export const NORMALIZR_ENTITY_NAME = 'Entity';
export const NORMALIZR_OBJECT_NAME = 'Object';
export const NORMALIZR_SCHEMA_KEY_PARAM = 'key';
export const NORMALIZR_ID_ATTRIBUTE_PARAM = 'idAttribute';

export const GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME = 'request';
export const GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME = 'pathParameters';
export const GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME = 'queryParameters';
export const GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME = 'requestBody';
export const GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME = 'options';
export const GENERATED_HOOK_META_NORMALIZATION_SCHEMA_PARAMETER_NAME = 'normalizationSchema';

export type StatementConflictHandler = (newSource: Statement | undefined, existingSource: Statement | undefined) => Statement | undefined;

export const defaultStatementConflictHandler: StatementConflictHandler = (newSource) => newSource;

export type MethodParameterNameMap = { merged: string } | { body?: string; path?: string; query?: string };

export interface MethodGeneratorConfig {
  auth: ParsedAuthType | undefined;
  method: GeneratedClientFunction;
  queryHookName: ReactQueryHookName;
  queryOptionsTypeName: string;
  queryKeyParameterName: string;
  queryFnParameterName: string;
  hookName: string;
  file: PluginFile<SourceFile>;
  relatedEntity?: NormalizerEntity;
  responseEntity?: NormalizerEntity;
  parameterNameMap?: MethodParameterNameMap;
}

export type BaseUrlOrGetter = string | ts.Expression | ((config: MethodGeneratorConfig) => string | ts.Expression);

export const defaultBaseUrlOrGetter: BaseUrlOrGetter = '';

export type HookHeadOrGetter = ts.Statement[] | ((config: MethodGeneratorConfig, defaultStatement: ts.Statement[]) => ts.Statement[]);

export const defaultHookHeaderOrGetter: HookHeadOrGetter = (_, defaultStatement) => defaultStatement;

export type RequestEnabledOrGetter =
  | boolean
  | ts.Expression
  | ((
      config: MethodGeneratorConfig,
      defaultEnabledExpression: ts.Expression,
      requiredParameterAccessProperties: ts.PropertyAccessExpression[],
    ) => ts.Expression | boolean | undefined);

export const defaultRequestEnabledOrGetter: RequestEnabledOrGetter = true;

export type RequestInitOrGetter = ts.Expression | undefined | ((config: MethodGeneratorConfig) => ts.Expression | undefined);

export const defaultRequestInitOrGetter: RequestInitOrGetter = undefined;

export type HookNameWriter = (generatedMethod: GeneratedClientFunction) => string;

export const defaultHookNameWriter: HookNameWriter = (generatedMethod: GeneratedClientFunction) => camelCase(`use-${generatedMethod.generatedName}`);

export type ReactQueryKeyGetter = (config: MethodGeneratorConfig, defaultGeneratedKey: ts.Expression | undefined) => ts.Expression;

export const defaultReactQueryKeyGetter: ReactQueryKeyGetter = (config, generatedKey) => {
  if (generatedKey) {
    return generatedKey;
  }

  const entityKeyExpression = config.relatedEntity
    ? factory.createPropertyAccessExpression(
        factory.createIdentifier(config.relatedEntity.entityVariableName),
        factory.createIdentifier(NORMALIZR_SCHEMA_KEY_PARAM),
      )
    : factory.createStringLiteral(NormalizedQueryPlugin.getMethodEntityName(config.method), true);

  return factory.createArrayLiteralExpression([entityKeyExpression]);
};

export type ReactQueryOptionsGetter = (
  config: MethodGeneratorConfig,
  builtOptions: ts.ObjectLiteralElementLike[],
  head: ts.Statement[],
) => ts.ObjectLiteralElementLike[];

export const defaultReactQueryOptionsGetter: ReactQueryOptionsGetter = (_, builtOptions) => builtOptions;

export type EntityNameWriter = (schema: GeneratedSchema) => string;

export const defaultEntityNameWriter: EntityNameWriter = (schema: GeneratedSchema) => camelCase(`${schema.generatedName}-Entity`);

export type EntitySchemaNameConstNameWriter = (schema: GeneratedSchema) => string;

export const defaultEntitySchemaNameConstNameWriter: EntitySchemaNameConstNameWriter = (schema: GeneratedSchema) =>
  constantCase(`${schema.generatedName}-Entity-Name`);

export interface NormalizerEntity extends GeneratedSchema<ParsedObject> {
  entityName: string;
  entityNameConstName?: string;
  entityVariableName: string;
  primaryKeys?: string[];
  importConfig: GeneratedImportPath;
  references?: Map<string, EntityReference>;
}

export interface NormalizedQueryPluginConfig extends PluginConfig<SourceFile, PluginFileGeneratorConfig<SourceFile>> {
  entity: {
    nameWriter: EntityNameWriter;
    schemaNameConstNameWriter: EntitySchemaNameConstNameWriter;
  };
  hook: {
    baseUrlOrGetter: BaseUrlOrGetter;
    headOrGetter: HookHeadOrGetter;
    nameWriter: HookNameWriter;
    requestEnabledOrGetter: RequestEnabledOrGetter;
    reactQueryKeyGetter: ReactQueryKeyGetter;
    reactQueryOptionsGetter: ReactQueryOptionsGetter;
    requestInitOrGetter: RequestInitOrGetter;
  };
  statementConflictHandler: StatementConflictHandler;
}

export type NormalizedQueryPluginHookConfigInput = Partial<NormalizedQueryPluginConfig['hook']>;

export type NormalizedQueryPluginEntityConfigInput = Partial<NormalizedQueryPluginConfig['entity']>;

export type NormalizedQueryPluginConfigInput = Optional<
  Omit<NormalizedQueryPluginConfig, 'hook' | 'entity' | 'defaultExistingFileReader' | 'defaultFileHooks'> & {
    hook?: NormalizedQueryPluginHookConfigInput;
    entity?: NormalizedQueryPluginEntityConfigInput;
  },
  'entity' | 'hook'
>;

export class NormalizedQueryPlugin extends PluginBase<SourceFile, PluginFileGeneratorConfig<SourceFile>, NormalizedQueryPluginConfig> {
  name = 'NormalizedQueryPlugin';

  private static getPostBuildHook(baseConfig: Omit<NormalizedQueryPluginConfig, 'defaultFileHooks'>) {
    const mergedPostBuildHook: PluginFilePostBuildHook<SourceFile> = async (file, fileToWrite) => {
      const { content } = fileToWrite;

      const existingFileContent = await file.getExistingFileContent();

      if (!existingFileContent) {
        return content;
      }

      // Check for existing content and merge it with the new content
      const newFileAsSourceFile = new Project({ useInMemoryFileSystem: true }).createSourceFile(fileToWrite.fileName, content);

      const newFileStatements = newFileAsSourceFile.getStatements();
      const existingFileStatements = existingFileContent.getStatements() || [];
      const handledStatements = new Set<Statement>();

      for (const newStatement of newFileStatements) {
        const existingStatement = findMatchingVariableStatement(newStatement, existingFileStatements);

        handledStatements.add(newStatement);

        if (existingStatement) {
          handledStatements.add(existingStatement);
        }

        if (newStatement.getText() !== existingStatement?.getText()) {
          const out = baseConfig.statementConflictHandler(newStatement, existingStatement);

          if (out) {
            if (out.getText() !== newStatement.getText()) {
              newStatement.replaceWithText(out.getText());
            }
          } else {
            newStatement.remove();
          }
        }
      }

      for (const existingStatement of existingFileStatements) {
        if (!handledStatements.has(existingStatement)) {
          const newStatement = findMatchingVariableStatement(existingStatement, newFileStatements);

          if (newStatement) {
            handledStatements.add(newStatement);
          }

          if (!newStatement || existingStatement.getText() !== newStatement.getText()) {
            const out = baseConfig.statementConflictHandler(newStatement, existingStatement);

            if (out) {
              if (!newStatement) {
                newFileAsSourceFile.addStatements(out.getText());
              } else if (out.getText() !== newStatement.getText()) {
                newStatement.replaceWithText(out.getText());
              }
            }
          }
        }
      }

      newFileAsSourceFile.saveSync();

      return newFileAsSourceFile.getFullText();
    };

    return mergedPostBuildHook;
  }

  private static buildConfig(config: NormalizedQueryPluginConfigInput) {
    const baseConfig: Omit<NormalizedQueryPluginConfig, 'defaultFileHooks'> = {
      ...config,
      entity: {
        nameWriter: config.entity?.nameWriter ?? defaultEntityNameWriter,
        schemaNameConstNameWriter: config.entity?.schemaNameConstNameWriter ?? defaultEntitySchemaNameConstNameWriter,
      },
      hook: {
        ...config.hook,
        baseUrlOrGetter: config.hook?.baseUrlOrGetter ?? defaultBaseUrlOrGetter,
        headOrGetter: config.hook?.headOrGetter ?? defaultHookHeaderOrGetter,
        nameWriter: config.hook?.nameWriter ?? defaultHookNameWriter,
        requestEnabledOrGetter: config.hook?.requestEnabledOrGetter ?? defaultRequestEnabledOrGetter,
        reactQueryKeyGetter: config.hook?.reactQueryKeyGetter ?? defaultReactQueryKeyGetter,
        reactQueryOptionsGetter: config.hook?.reactQueryOptionsGetter ?? defaultReactQueryOptionsGetter,
        requestInitOrGetter: config.hook?.requestInitOrGetter || defaultRequestInitOrGetter,
      },
      defaultExistingFileReader: pluginFileReader,
      statementConflictHandler: config.statementConflictHandler || defaultStatementConflictHandler,
    };

    return {
      ...baseConfig,
      defaultFileHooks: {
        postBuildHook: NormalizedQueryPlugin.getPostBuildHook(baseConfig),
      },
    };
  }

  constructor(config: NormalizedQueryPluginConfigInput) {
    super(NormalizedQueryPlugin.buildConfig(config));
  }

  private generatedEntities: Map<string, NormalizerEntity> = new Map();

  private static getEntityName(schema: GeneratedSchema) {
    return match(schema.rawSchema)
      .with({ object: { name: P.string } }, (r) => r.object.entity?.stateEntityFullName || r.object.fullGrpcName)
      .with({ oneOf: { name: P.string } }, (r) => r.oneOf.fullGrpcName)
      .with({ enum: { name: P.string } }, (r) => r.enum.fullGrpcName)
      .otherwise(() => schema.generatedName);
  }

  private static getEntityPrimaryKeys(schema: GeneratedSchema): string[] | undefined {
    return match(schema.rawSchema)
      .with({ object: { entity: { primaryKeys: P.not(P.nullish) } } }, (s) => s.object.entity.primaryKeys)
      .otherwise(() => undefined);
  }

  private static getImportPathForGeneratedFiles(from: PluginFile<SourceFile>, to: PluginFile<SourceFile>) {
    return getImportPath(to.config.directory, to.config.fileName, from.config.directory, from.config.fileName);
  }

  private static findMatchingProperty(properties: Map<string, ParsedObjectProperty>, fullGrpcName: string) {
    for (const entry of properties || []) {
      if (getFullGRPCName(entry[1].schema) === fullGrpcName) {
        return entry;
      }
    }

    return undefined;
  }

  private static generateIdAttributeAccessor(entity: NormalizerEntity) {
    const entityArgName = 'entity';
    const hasDotSeparation = entity.primaryKeys?.some((key) => key.includes('.'));

    if (!entity?.primaryKeys?.length) {
      return undefined;
    }

    if (!hasDotSeparation && entity?.primaryKeys?.length === 1) {
      return factory.createStringLiteral(entity.primaryKeys[0], true);
    }

    return factory.createArrowFunction(
      undefined,
      undefined,
      [factory.createParameterDeclaration(undefined, undefined, entityArgName, undefined, factory.createTypeReferenceNode(entity.generatedName))],
      undefined,
      factory.createToken(SyntaxKind.EqualsGreaterThanToken),
      factory.createTemplateExpression(
        factory.createTemplateHead(''),
        entity.primaryKeys.reduce<ts.TemplateSpan[]>(
          (acc, curr, i, arr) => [
            ...acc,
            factory.createTemplateSpan(
              factory.createPropertyAccessExpression(
                factory.createIdentifier(entityArgName),
                factory.createIdentifier(`${curr.split('.').join('?.')}` || ''),
              ),
              i === arr.length - 1 ? factory.createTemplateTail('') : factory.createTemplateMiddle('-'),
            ),
          ],
          [],
        ),
      ),
    );
  }

  private getEntityFile(entity: NormalizerEntity) {
    return this.files.find(
      (file) => file.config.directory === entity.importConfig.directory && file.config.fileName === entity.importConfig.fileName,
    );
  }

  private addEntityReferenceImports(file: PluginFile<SourceFile>, entityReferences: Map<string, EntityReference>) {
    for (const [, ref] of entityReferences) {
      match(ref)
        .with({ entity: P.not(P.nullish) }, (r) => {
          const entityFile = this.getEntityFile(r.entity);

          if (entityFile && entityFile !== file) {
            file.addImportToOtherGeneratedFile(entityFile, [r.entity.entityVariableName]);
          }
        })
        .with({ schema: P.not(P.nullish) }, (r) => this.addEntityReferenceImports(file, r.schema));
    }
  }

  private generateEntity(fileForSchema: PluginFile<SourceFile>, schema: GeneratedSchema): NormalizerEntity | undefined {
    const isEntity = match(schema.rawSchema)
      .with({ object: { entity: { primaryKeys: P.not(P.nullish) } } }, () => true)
      .otherwise(() => false);

    if (!isEntity) {
      return undefined;
    }

    if (this.generatedEntities.has(schema.generatedName)) {
      return this.generatedEntities.get(schema.generatedName);
    }

    // For state entities, add the generated type to the import list and build a normalization schema for them
    const entityPrimaryKeys = NormalizedQueryPlugin.getEntityPrimaryKeys(schema);

    if (!entityPrimaryKeys?.length) {
      return undefined;
    }

    const entityName = NormalizedQueryPlugin.getEntityName(schema);
    const entityVariableName = this.pluginConfig.entity.nameWriter(schema);
    const entityNameConstName = this.pluginConfig.entity.schemaNameConstNameWriter(schema);

    fileForSchema.addGeneratedTypeImport(schema.generatedName);

    // Import from normalizr for the file, as it contains entities
    fileForSchema.addManualImport(NORMALIZR_IMPORT_PATH, [NORMALIZR_SCHEMA_NAME]);

    const generatedEntity: NormalizerEntity = {
      ...(schema as GeneratedSchema<ParsedObject>),
      entityName,
      entityNameConstName,
      entityVariableName,
      primaryKeys: entityPrimaryKeys,
      importConfig: fileForSchema.config,
    };

    const idAttribute = NormalizedQueryPlugin.generateIdAttributeAccessor(generatedEntity);

    if (!idAttribute) {
      return undefined;
    }

    generatedEntity.references = this.findEntityReferences(schema.rawSchema);

    this.addEntityReferenceImports(fileForSchema, generatedEntity.references);

    fileForSchema.addNodes(
      factory.createVariableStatement(
        [factory.createModifier(SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(entityNameConstName, undefined, undefined, factory.createStringLiteral(entityName, true))],
          ts.NodeFlags.Const,
        ),
      ),
      factory.createVariableStatement(
        [factory.createModifier(SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              entityVariableName,
              undefined,
              undefined,
              factory.createNewExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier(NORMALIZR_SCHEMA_NAME), NORMALIZR_ENTITY_NAME),
                [factory.createTypeReferenceNode(schema.generatedName)],
                [
                  factory.createIdentifier(entityNameConstName),
                  NormalizedQueryPlugin.buildEntityReferenceMap(generatedEntity.references),
                  factory.createObjectLiteralExpression([factory.createPropertyAssignment(NORMALIZR_ID_ATTRIBUTE_PARAM, idAttribute)]),
                ],
              ),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
      factory.createIdentifier('\n'),
    );

    this.generatedEntities.set(schema.generatedName, generatedEntity);

    return generatedEntity;
  }

  private getEntityReference(schema: ParsedSchemaWithRef): GeneratedSchema | undefined {
    return match(schema)
      .with({ object: { entity: P.not(P.nullish) } }, (r) => this.generatedSchemas.get(r.object.fullGrpcName))
      .with({ $ref: P.string }, (r) => {
        const refValue = this.generatedSchemas.get(cleanRefName(r));
        return refValue ? this.getEntityReference(refValue.rawSchema) : undefined;
      })
      .with({ array: { itemSchema: P.not(P.nullish) } }, (r) => this.getEntityReference(r.array.itemSchema))
      .otherwise(() => undefined);
  }

  private static isSchemaArray(schema: ParsedSchemaWithRef) {
    return match(schema)
      .with({ array: P.not(P.nullish) }, () => true)
      .otherwise(() => false);
  }

  private findEntityReferences(schema: ParsedSchemaWithRef) {
    const digForEntityReferences = (properties: Map<string, ParsedObjectProperty>): Map<string, EntityReference> => {
      const subRefs = new Map<string, EntityReference>();

      for (const [propertyName, property] of properties) {
        const isArray = NormalizedQueryPlugin.isSchemaArray(property.schema);
        const entityReference = this.getEntityReference(property.schema);

        if (entityReference) {
          let generatedEntity = this.generatedEntities.get(entityReference.generatedName);

          if (!generatedEntity) {
            const fileForSubSchema = this.getFileForSchema(entityReference);

            if (fileForSubSchema) {
              generatedEntity = this.generateEntity(fileForSubSchema, entityReference);
            }
          }

          if (generatedEntity) {
            subRefs.set(propertyName, { isArray, entity: generatedEntity });
          }
        } else {
          const subProperties = this.findSchemaProperties(property.schema);

          if (subProperties.size) {
            const subPropertyRefs = digForEntityReferences(subProperties);

            if (subPropertyRefs.size) {
              subRefs.set(propertyName, { isArray, schema: subPropertyRefs });
            }
          }
        }
      }

      return subRefs;
    };

    return digForEntityReferences(this.findSchemaProperties(schema));
  }

  private static buildNormalizrObject(entityReferences: Map<string, EntityReference>, schemaName?: string) {
    return factory.createNewExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier(NORMALIZR_SCHEMA_NAME), NORMALIZR_OBJECT_NAME),
      schemaName ? [factory.createTypeReferenceNode(schemaName)] : [],
      [NormalizedQueryPlugin.buildEntityReferenceMap(entityReferences)],
    );
  }

  private static buildEntityReferenceMap(entityReferences: Map<string, EntityReference>): ts.ObjectLiteralExpression {
    const properties: ts.ObjectLiteralElementLike[] = [];

    for (const [key, value] of entityReferences) {
      const property = match(value)
        .with({ entity: P.not(P.nullish) }, (s) => {
          const baseIdentifier = factory.createIdentifier(s.entity.entityVariableName);
          return factory.createPropertyAssignment(key, s.isArray ? factory.createArrayLiteralExpression([baseIdentifier]) : baseIdentifier);
        })
        .with({ schema: P.not(P.nullish) }, (s) => {
          const normalizrObject = NormalizedQueryPlugin.buildNormalizrObject(s.schema);
          return factory.createPropertyAssignment(key, s.isArray ? factory.createArrayLiteralExpression([normalizrObject]) : normalizrObject);
        })
        .otherwise(() => undefined);

      if (property) {
        properties.push(property);
      }
    }

    return factory.createObjectLiteralExpression(properties, true);
  }

  private generateResponseEntity(fileForSchema: PluginFile<SourceFile>, schema: GeneratedSchema) {
    if (this.generatedEntities.has(schema.generatedName)) {
      return this.generatedEntities.get(schema.generatedName);
    }

    const entityReferences = this.findEntityReferences(schema.rawSchema);

    if (!entityReferences?.size) {
      return undefined;
    }

    const entityVariableName = this.pluginConfig.entity.nameWriter(schema);
    fileForSchema.addGeneratedTypeImport(schema.generatedName);

    // Import from normalizr for the file, as it contains entities
    fileForSchema.addManualImport(NORMALIZR_IMPORT_PATH, [NORMALIZR_SCHEMA_NAME]);

    const generatedEntity: NormalizerEntity = {
      ...(schema as GeneratedSchema<ParsedObject>),
      entityName: NormalizedQueryPlugin.getEntityName(schema),
      entityVariableName,
      importConfig: fileForSchema.config,
      references: entityReferences,
    };

    this.addEntityReferenceImports(fileForSchema, entityReferences);

    this.generatedEntities.set(schema.generatedName, generatedEntity);

    fileForSchema.addNodes(
      factory.createVariableStatement(
        [factory.createModifier(SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              entityVariableName,
              undefined,
              undefined,
              NormalizedQueryPlugin.buildNormalizrObject(entityReferences, schema.generatedName),
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    );

    return generatedEntity;
  }

  private static getMethodReactQueryHookName(generatedMethod: GeneratedClientFunction): ReactQueryHookName {
    const { responseBody } = generatedMethod.method.rawMethod;
    const properties = match(responseBody)
      .with({ object: { properties: P.not(P.nullish) } }, (r) => r.object.properties)
      .with({ oneOf: { properties: P.not(P.nullish) } }, (r) => r.oneOf.properties)
      .otherwise(() => undefined);

    for (const [, property] of properties || []) {
      if (
        match(property.schema)
          .with(
            P.union(
              { $ref: P.string.endsWith(J5_LIST_PAGE_RESPONSE_TYPE) },
              { object: { fullGrpcName: J5_LIST_PAGE_RESPONSE_TYPE } },
              { oneOf: { fullGrpcName: J5_LIST_PAGE_RESPONSE_TYPE } },
            ),
            () => true,
          )
          .otherwise(() => false)
      ) {
        return REACT_QUERY_INFINITE_QUERY_HOOK_NAME;
      }
    }

    if (generatedMethod.method.relatedEntity?.rawSchema?.object?.entity) {
      if (generatedMethod.method.relatedEntity.rawSchema.object.entity.queryMethods?.includes(generatedMethod.method.rawMethod.fullGrpcName)) {
        return REACT_QUERY_QUERY_HOOK_NAME;
      }

      if (generatedMethod.method.relatedEntity.rawSchema.object.entity.commandMethods?.includes(generatedMethod.method.rawMethod.fullGrpcName)) {
        return REACT_QUERY_MUTATION_HOOK_NAME;
      }
    }

    if (['post', 'delete', 'put', 'patch'].includes(generatedMethod.method.rawMethod.httpMethod.toLowerCase())) {
      return REACT_QUERY_MUTATION_HOOK_NAME;
    }

    return REACT_QUERY_QUERY_HOOK_NAME;
  }

  public static getMethodEntityName(generatedMethod: GeneratedClientFunction) {
    return match(generatedMethod)
      .with(
        { method: { relatedEntity: { rawSchema: { object: { entity: P.not(P.nullish) } } } } },
        (r) =>
          r.method.relatedEntity.rawSchema.object.entity.stateEntityFullName ||
          r.method.relatedEntity.rawSchema.object.entity.entity ||
          r.method.relatedEntity.generatedName,
      )
      .otherwise(() => generatedMethod.generatedName);
  }

  private static buildHookParameterDeclaration(parameterName: string, schema: GeneratedSchema<ParsedObject>, addedNonOptionalParameter: boolean) {
    let hasARequiredParameter = false;

    for (const [, value] of schema.rawSchema.object.properties) {
      if (value.required) {
        hasARequiredParameter = true;
        break;
      }
    }

    return factory.createParameterDeclaration(
      undefined,
      undefined,
      parameterName,
      hasARequiredParameter || addedNonOptionalParameter ? undefined : optionalQuestionToken,
      factory.createTypeReferenceNode(schema.generatedName),
    );
  }

  private static buildAggregatedSplitRequestType(generatedMethod: GeneratedClientFunction) {
    const props: ts.PropertySignature[] = [];

    if (generatedMethod.method.pathParametersSchema) {
      props.push(
        factory.createPropertySignature(
          undefined,
          GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME,
          optionalQuestionToken,
          factory.createTypeReferenceNode(generatedMethod.method.pathParametersSchema.generatedName),
        ),
      );
    }

    if (generatedMethod.method.queryParametersSchema) {
      props.push(
        factory.createPropertySignature(
          undefined,
          GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME,
          optionalQuestionToken,
          factory.createTypeReferenceNode(generatedMethod.method.queryParametersSchema.generatedName),
        ),
      );
    }

    if (generatedMethod.method.requestBodySchema) {
      props.push(
        factory.createPropertySignature(
          undefined,
          GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME,
          optionalQuestionToken,
          factory.createTypeReferenceNode(generatedMethod.method.requestBodySchema.generatedName),
        ),
      );
    }

    if (!props.length) {
      return undefined;
    }

    return factory.createTypeLiteralNode(props);
  }

  private buildQueryFnRequestType(generatedMethod: GeneratedClientFunction) {
    switch (this.config?.types.requestType) {
      case 'split': {
        const aggregatedSplitRequestType = NormalizedQueryPlugin.buildAggregatedSplitRequestType(generatedMethod);
        if (aggregatedSplitRequestType) {
          return aggregatedSplitRequestType;
        }

        break;
      }
      case 'merged':
      default: {
        if (generatedMethod.method.mergedRequestSchema) {
          return factory.createTypeReferenceNode(generatedMethod.method.mergedRequestSchema.generatedName);
        }

        break;
      }
    }

    return factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword);
  }

  private buildReactQueryOptionsParameter(generatorConfig: MethodGeneratorConfig) {
    const returnType = generatorConfig.method.method.responseBodySchema
      ? factory.createUnionTypeNode([
          factory.createTypeReferenceNode(generatorConfig.method.method.responseBodySchema.generatedName),
          factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
        ])
      : factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword);

    const typeArgs = match(generatorConfig.queryHookName)
      .returnType<ts.TypeNode[]>()
      .with(REACT_QUERY_MUTATION_HOOK_NAME, () => {
        switch (this.config?.types.requestType) {
          case 'split': {
            const aggregatedSplitRequestType = NormalizedQueryPlugin.buildAggregatedSplitRequestType(generatorConfig.method);
            if (aggregatedSplitRequestType) {
              return [
                returnType,
                factory.createTypeReferenceNode('Error'),
                aggregatedSplitRequestType,
                factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword),
              ];
            }

            break;
          }
          case 'merged':
          default: {
            if (generatorConfig.method.method.mergedRequestSchema) {
              return [
                returnType,
                factory.createTypeReferenceNode('Error'),
                factory.createTypeReferenceNode(generatorConfig.method.method.mergedRequestSchema.generatedName),
                factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword),
              ];
            }
          }
        }

        return [
          returnType,
          factory.createTypeReferenceNode('Error'),
          factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
          factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword),
        ];
      })
      .with(REACT_QUERY_INFINITE_QUERY_HOOK_NAME, () => [
        returnType,
        factory.createTypeReferenceNode('Error'),
        factory.createTypeReferenceNode(REACT_QUERY_INFINITE_DATA_TYPE_NAME, [returnType]),
        returnType,
        factory.createTypeReferenceNode(REACT_QUERY_QUERY_KEY_TYPE_NAME),
        factory.createUnionTypeNode([
          factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
          factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
        ]),
      ])
      .otherwise(() => [returnType]);

    return factory.createParameterDeclaration(
      undefined,
      undefined,
      GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME,
      optionalQuestionToken,
      factory.createTypeReferenceNode('Partial', [factory.createTypeReferenceNode(generatorConfig.queryOptionsTypeName, typeArgs)]),
    );
  }

  private buildBaseParameters(generatorConfig: MethodGeneratorConfig) {
    const parameters: ts.ParameterDeclaration[] = [];

    if (generatorConfig.queryHookName !== REACT_QUERY_MUTATION_HOOK_NAME) {
      switch (this.config?.types.requestType) {
        case 'split': {
          let addedNonOptionalParameter = false;

          if (generatorConfig.method.method.pathParametersSchema) {
            const parameter = NormalizedQueryPlugin.buildHookParameterDeclaration(
              GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME,
              generatorConfig.method.method.pathParametersSchema,
              addedNonOptionalParameter,
            );

            parameters.push(parameter);

            addedNonOptionalParameter = addedNonOptionalParameter || parameter.questionToken !== undefined;
          }

          if (generatorConfig.method.method.queryParametersSchema) {
            const parameter = NormalizedQueryPlugin.buildHookParameterDeclaration(
              GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME,
              generatorConfig.method.method.queryParametersSchema,
              addedNonOptionalParameter,
            );

            parameters.push(parameter);

            addedNonOptionalParameter = addedNonOptionalParameter || parameter.questionToken !== undefined;
          }

          if (generatorConfig.method.method.requestBodySchema) {
            const parameter = NormalizedQueryPlugin.buildHookParameterDeclaration(
              GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME,
              generatorConfig.method.method.requestBodySchema,
              addedNonOptionalParameter,
            );

            parameters.push(parameter);
          }

          break;
        }
        case 'merged':
        default: {
          if (generatorConfig.method.method.mergedRequestSchema) {
            parameters.push(
              NormalizedQueryPlugin.buildHookParameterDeclaration(
                GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
                generatorConfig.method.method.mergedRequestSchema,
                false,
              ),
            );
          }

          break;
        }
      }
    }

    const optionParameter = this.buildReactQueryOptionsParameter(generatorConfig);

    if (optionParameter) {
      parameters.push(optionParameter);
    }

    return parameters;
  }

  private buildClientFnArgs(generatorConfig: MethodGeneratorConfig, parameters: ts.ParameterDeclaration[]) {
    const baseUrl =
      typeof this.pluginConfig.hook.baseUrlOrGetter === 'function'
        ? this.pluginConfig.hook.baseUrlOrGetter(generatorConfig)
        : this.pluginConfig.hook.baseUrlOrGetter || '';
    const baseUrlArg = typeof baseUrl === 'string' ? factory.createStringLiteral(baseUrl, true) : baseUrl;
    const requestInit =
      typeof this.pluginConfig.hook.requestInitOrGetter === 'function'
        ? this.pluginConfig.hook.requestInitOrGetter(generatorConfig)
        : this.pluginConfig.hook.requestInitOrGetter || undefined;

    const args: ts.Expression[] = [baseUrlArg];

    switch (generatorConfig.queryHookName) {
      case REACT_QUERY_QUERY_HOOK_NAME: {
        parameters.forEach((curr) => {
          const arg = match(curr.name)
            .with(
              {
                escapedText: P.union(
                  GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
                  GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME,
                  GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME,
                  GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME,
                ).select(),
              },
              (s) => factory.createIdentifier(s.toString()),
            )
            .otherwise(() => undefined);

          if (arg) {
            args.push(arg);
          }
        });

        break;
      }
      case REACT_QUERY_INFINITE_QUERY_HOOK_NAME: {
        parameters.forEach((curr) => {
          // Find page parameter location
          const argName = match(curr.name)
            .with(
              {
                escapedText: P.union(
                  GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
                  GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME,
                  GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME,
                  GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME,
                ).select(),
              },
              (s) => s.toString(),
            )
            .otherwise(() => undefined);

          if (argName) {
            const argNameProperties = match(argName)
              .with(GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME, () =>
                getObjectProperties(generatorConfig.method.method.mergedRequestSchema?.rawSchema),
              )
              .with(GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME, () =>
                getObjectProperties(generatorConfig.method.method.pathParametersSchema?.rawSchema),
              )
              .with(GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME, () =>
                getObjectProperties(generatorConfig.method.method.queryParametersSchema?.rawSchema),
              )
              .with(GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME, () => getObjectProperties(generatorConfig.method.method.requestBodySchema?.rawSchema))
              .otherwise(() => new Map());

            let createdSpreadElement = false;

            const matchingProp = NormalizedQueryPlugin.findMatchingProperty(argNameProperties || new Map(), J5_LIST_PAGE_REQUEST_TYPE);

            if (matchingProp) {
              args.push(
                factory.createObjectLiteralExpression(
                  [
                    factory.createSpreadAssignment(factory.createIdentifier(argName)),
                    factory.createPropertyAssignment(
                      matchingProp[0],
                      factory.createConditionalExpression(
                        factory.createIdentifier(REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME),
                        factory.createToken(SyntaxKind.QuestionToken),
                        factory.createObjectLiteralExpression(
                          [
                            factory.createPropertyAssignment(
                              factory.createIdentifier(J5_LIST_PAGE_REQUEST_PAGINATION_TOKEN_PARAM_NAME),
                              factory.createIdentifier(REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME),
                            ),
                          ],
                          false,
                        ),
                        factory.createToken(SyntaxKind.ColonToken),
                        factory.createIdentifier('undefined'),
                      ),
                    ),
                  ],
                  false,
                ),
              );

              createdSpreadElement = true;
            }

            if (!createdSpreadElement) {
              args.push(factory.createIdentifier(argName));
            }
          }
        });

        break;
      }
      case REACT_QUERY_MUTATION_HOOK_NAME: {
        const requestType = this.buildQueryFnRequestType(generatorConfig.method);

        if (requestType.kind === SyntaxKind.UndefinedKeyword) {
          break;
        }

        switch (this.config?.types.requestType) {
          case 'split': {
            args.push(
              generatorConfig.method.method.pathParametersSchema
                ? factory.createPropertyAccessExpression(
                    factory.createIdentifier(GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME),
                    factory.createIdentifier(GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME),
                  )
                : factory.createIdentifier('undefined'),
              generatorConfig.method.method.queryParametersSchema
                ? factory.createPropertyAccessExpression(
                    factory.createIdentifier(GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME),
                    factory.createIdentifier(GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME),
                  )
                : factory.createIdentifier('undefined'),
              generatorConfig.method.method.requestBodySchema
                ? factory.createPropertyAccessExpression(
                    factory.createIdentifier(GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME),
                    factory.createIdentifier(GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME),
                  )
                : factory.createIdentifier('undefined'),
            );

            break;
          }
          case 'merged':
          default: {
            args.push(
              factory.createIdentifier(
                generatorConfig.method.method.mergedRequestSchema ? GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME : 'undefined',
              ),
            );

            break;
          }
        }

        break;
      }
      default:
        break;
    }

    if (requestInit) {
      args.push(requestInit);
    }

    return args;
  }

  private buildQueryFnArgs(generatorConfig: MethodGeneratorConfig): ts.ParameterDeclaration[] {
    switch (generatorConfig.queryHookName) {
      case REACT_QUERY_QUERY_HOOK_NAME:
        return [];
      case REACT_QUERY_MUTATION_HOOK_NAME: {
        const requestType = this.buildQueryFnRequestType(generatorConfig.method);

        return requestType && requestType.kind !== SyntaxKind.UndefinedKeyword
          ? [factory.createParameterDeclaration(undefined, undefined, GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME, undefined, requestType)]
          : [];
      }
      case REACT_QUERY_INFINITE_QUERY_HOOK_NAME: {
        return [
          factory.createParameterDeclaration(
            undefined,
            undefined,
            factory.createObjectBindingPattern([factory.createBindingElement(undefined, undefined, REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME)]),
          ),
        ];
      }
      default:
        return [];
    }
  }

  private generateAndAddResponseEntity(generatedMethod: GeneratedClientFunction, clientFnFile: PluginFile<SourceFile>) {
    if (generatedMethod.method.responseBodySchema) {
      const responseBodyFile = this.getFileForSchema(generatedMethod.method.responseBodySchema);
      const file = responseBodyFile || clientFnFile;

      const responseEntity = this.generateResponseEntity(file, generatedMethod.method.responseBodySchema);

      // Import the new response entity into the client function file
      if (responseEntity && file && file !== clientFnFile) {
        clientFnFile.addManualImport(NormalizedQueryPlugin.getImportPathForGeneratedFiles(clientFnFile, file), [responseEntity.entityVariableName]);
      }

      return responseEntity;
    }

    return undefined;
  }

  private buildGeneratorConfig(file: PluginFile<SourceFile>, generatedMethod: GeneratedClientFunction): MethodGeneratorConfig | undefined {
    const queryHookName = NormalizedQueryPlugin.getMethodReactQueryHookName(generatedMethod);

    const relatedEntity = generatedMethod.method.relatedEntity?.generatedName
      ? this.generatedEntities.get(generatedMethod.method.relatedEntity.generatedName)
      : undefined;

    if (relatedEntity) {
      const entityFile = this.getEntityFile(relatedEntity);

      if (entityFile && entityFile !== file) {
        file.addManualImport(NormalizedQueryPlugin.getImportPathForGeneratedFiles(file, entityFile), [relatedEntity.entityVariableName]);
      }
    }

    const optionsTypeName = REACT_QUERY_OPTIONS_TYPE_BY_HOOK_NAME[queryHookName];

    const reactQueryImports = [queryHookName, optionsTypeName];
    const reactQueryTypeOnlyImports = [optionsTypeName];

    if (queryHookName === REACT_QUERY_INFINITE_QUERY_HOOK_NAME) {
      reactQueryImports.push(REACT_QUERY_INFINITE_DATA_TYPE_NAME, REACT_QUERY_QUERY_KEY_TYPE_NAME);
      reactQueryTypeOnlyImports.push(REACT_QUERY_INFINITE_DATA_TYPE_NAME, REACT_QUERY_QUERY_KEY_TYPE_NAME);
    }

    file.addManualImport(REACT_QUERY_IMPORT_PATH, reactQueryImports, reactQueryTypeOnlyImports);

    return {
      auth: generatedMethod.method.rawMethod.auth,
      method: generatedMethod,
      queryHookName,
      queryKeyParameterName: REACT_QUERY_FN_KEY_PARAMETER_NAME_BY_HOOK_NAME[queryHookName],
      queryOptionsTypeName: optionsTypeName,
      queryFnParameterName: REACT_QUERY_FN_PARAMETER_NAME_BY_HOOK_NAME[queryHookName],
      file,
      hookName: this.pluginConfig.hook.nameWriter(generatedMethod),
      relatedEntity,
      responseEntity: this.generateAndAddResponseEntity(generatedMethod, file),
      parameterNameMap: match({ type: this.config?.types.requestType, ...generatedMethod.method })
        .returnType<MethodParameterNameMap | undefined>()
        .with({ type: 'split' }, (s) =>
          match(s)
            .with(
              P.union(
                { pathParametersSchema: P.not(P.nullish) },
                { queryParametersSchema: P.not(P.nullish) },
                { requestBodySchema: P.not(P.nullish) },
              ),
              (sub) => ({
                path: sub.pathParametersSchema ? GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME : undefined,
                query: sub.queryParametersSchema ? GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME : undefined,
                body: sub.requestBodySchema ? GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME : undefined,
              }),
            )
            .otherwise(() => undefined),
        )
        .with({ type: 'merged', mergedRequestSchema: P.not(P.nullish) }, () => ({
          merged: GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
        }))
        .otherwise(() => undefined),
    };
  }

  private getRequiredRequestParameters(generatorConfig: MethodGeneratorConfig) {
    const { method: generatedMethod } = generatorConfig.method;

    function collectRequired(parameterName: string, properties: Map<string, ParsedObjectProperty>) {
      const requiredProperties: ts.PropertyAccessExpression[] = [];

      for (const [propertyName, property] of properties || []) {
        if (property.required) {
          requiredProperties.push(
            factory.createPropertyAccessChain(
              factory.createIdentifier(parameterName),
              factory.createToken(SyntaxKind.QuestionDotToken),
              propertyName,
            ),
          );
        }
      }

      return requiredProperties;
    }

    switch (this.config?.types.requestType) {
      case 'split': {
        let required: ts.PropertyAccessExpression[] = [];

        const pathParameterName = match(generatorConfig.parameterNameMap)
          .with({ path: P.string.select() }, (s) => s)
          .otherwise(() => undefined);

        if (generatedMethod?.pathParametersSchema && pathParameterName) {
          required = [
            ...required,
            ...collectRequired(pathParameterName, getObjectProperties(generatedMethod.pathParametersSchema.rawSchema) || new Map()),
          ];
        }

        const queryParameterName = match(generatorConfig.parameterNameMap)
          .with({ query: P.string.select() }, (s) => s)
          .otherwise(() => undefined);

        if (generatedMethod?.queryParametersSchema && queryParameterName) {
          required = [
            ...required,
            ...collectRequired(queryParameterName, getObjectProperties(generatedMethod.queryParametersSchema.rawSchema) || new Map()),
          ];
        }

        const bodyParameterName = match(generatorConfig.parameterNameMap)
          .with({ body: P.string.select() }, (s) => s)
          .otherwise(() => undefined);

        if (generatedMethod?.requestBodySchema && bodyParameterName) {
          required = [
            ...required,
            ...collectRequired(bodyParameterName, getObjectProperties(generatedMethod.requestBodySchema.rawSchema) || new Map()),
          ];
        }

        return required;
      }
      case 'merged':
      default: {
        const mergedRequestParameterName = match(generatorConfig.parameterNameMap)
          .with({ merged: P.string.select() }, (s) => s)
          .otherwise(() => undefined);

        if (generatedMethod?.mergedRequestSchema && mergedRequestParameterName) {
          return collectRequired(mergedRequestParameterName, getObjectProperties(generatedMethod.mergedRequestSchema.rawSchema) || new Map());
        }

        return [];
      }
    }
  }

  private buildRequestEnabled(generatorConfig: MethodGeneratorConfig) {
    const requiredParameters = this.getRequiredRequestParameters(generatorConfig);
    const requiredParameterLogicalAnd = createLogicalAndChain(requiredParameters);
    const baseEnabled = requiredParameterLogicalAnd
      ? factory.createCallExpression(factory.createIdentifier('Boolean'), undefined, [requiredParameterLogicalAnd])
      : factory.createTrue();

    return match(this.pluginConfig.hook.requestEnabledOrGetter)
      .with(true, () => factory.createTrue())
      .with(false, () => factory.createFalse())
      .with(P.nullish, () => baseEnabled)
      .otherwise((r) => {
        if (typeof r === 'function') {
          const out = r(generatorConfig, baseEnabled, requiredParameters);

          if (typeof out === 'boolean') {
            return out ? factory.createTrue() : factory.createFalse();
          }

          return out || factory.createTrue();
        }

        return r;
      });
  }

  private generateHook(generatorConfig: MethodGeneratorConfig) {
    const parameters = this.buildBaseParameters(generatorConfig);
    const clientFnArgs = this.buildClientFnArgs(generatorConfig, parameters);
    const defaultQueryKey = defaultReactQueryKeyGetter(generatorConfig, undefined);

    const queryOptions: ts.ObjectLiteralElementLike[] = [
      factory.createPropertyAssignment(
        generatorConfig.queryKeyParameterName,
        this.pluginConfig.hook.reactQueryKeyGetter(generatorConfig, defaultQueryKey),
      ),
      factory.createPropertyAssignment(
        generatorConfig.queryFnParameterName,
        factory.createArrowFunction(
          [factory.createModifier(SyntaxKind.AsyncKeyword)],
          undefined,
          this.buildQueryFnArgs(generatorConfig),
          undefined,
          factory.createToken(SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(factory.createIdentifier(generatorConfig.method.generatedName), undefined, clientFnArgs),
        ),
      ),
      factory.createPropertyAssignment(REACT_QUERY_ENABLED_PARAM_NAME, this.buildRequestEnabled(generatorConfig)),
    ];

    if (generatorConfig.responseEntity) {
      queryOptions.push(
        factory.createPropertyAssignment(
          REACT_QUERY_META_PARAM_NAME,
          factory.createObjectLiteralExpression([
            factory.createPropertyAssignment(
              GENERATED_HOOK_META_NORMALIZATION_SCHEMA_PARAMETER_NAME,
              factory.createIdentifier(generatorConfig.responseEntity.entityVariableName),
            ),
          ]),
        ),
      );
    }

    if (generatorConfig.queryHookName === REACT_QUERY_INFINITE_QUERY_HOOK_NAME) {
      // Add getNextPage property
      const responseProperties = getObjectProperties(generatorConfig.method.method.responseBodySchema?.rawSchema);
      const pageParam = responseProperties ? NormalizedQueryPlugin.findMatchingProperty(responseProperties, J5_LIST_PAGE_RESPONSE_TYPE) : undefined;

      if (pageParam) {
        queryOptions.push(
          factory.createPropertyAssignment(
            REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_PARAM_NAME,
            factory.createArrowFunction(
              undefined,
              undefined,
              [factory.createParameterDeclaration(undefined, undefined, REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_FN_RESPONSE_PARAM_NAME)],
              undefined,
              factory.createToken(SyntaxKind.EqualsGreaterThanToken),
              factory.createPropertyAccessChain(
                factory.createPropertyAccessChain(
                  factory.createIdentifier(REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_FN_RESPONSE_PARAM_NAME),
                  factory.createToken(SyntaxKind.QuestionDotToken),
                  factory.createIdentifier(pageParam[0]),
                ),
                factory.createToken(SyntaxKind.QuestionDotToken),
                factory.createIdentifier(J5_LIST_PAGE_RESPONSE_PAGINATION_TOKEN_PARAM_NAME),
              ),
            ),
          ),
        );

        // Add initialPageParam property
        queryOptions.push(
          factory.createPropertyAssignment(REACT_QUERY_INFINITE_QUERY_INITIAL_PAGE_PARAM_NAME, factory.createIdentifier('undefined')),
        );
      }
    }

    const preload = generatorConfig.queryHookName === REACT_QUERY_QUERY_HOOK_NAME ? buildPreload(generatorConfig) : undefined;
    const defaultHead: ts.Statement[] = preload ? [preload] : [];
    const head =
      typeof this.pluginConfig.hook.headOrGetter === 'function'
        ? this.pluginConfig.hook.headOrGetter(generatorConfig, defaultHead)
        : (this.pluginConfig.hook.headOrGetter ?? defaultHead);

    if (head) {
      head.push(factory.createIdentifier('\n') as unknown as ts.Statement);
    }

    const finalOptions = this.pluginConfig.hook.reactQueryOptionsGetter
      ? this.pluginConfig.hook.reactQueryOptionsGetter(generatorConfig, queryOptions, head || [])
      : queryOptions;
    finalOptions.push(factory.createSpreadAssignment(factory.createIdentifier(GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME)));

    return factory.createFunctionDeclaration(
      [factory.createModifier(SyntaxKind.ExportKeyword)],
      undefined,
      generatorConfig.hookName,
      undefined,
      parameters,
      undefined,
      factory.createBlock(
        [
          ...(head || []),
          factory.createReturnStatement(
            factory.createCallExpression(factory.createIdentifier(generatorConfig.queryHookName), undefined, [
              factory.createObjectLiteralExpression(finalOptions, true),
            ]),
          ),
        ],
        true,
      ),
    );
  }

  private static addMethodTypeImports(file: PluginFile<SourceFile>, generatedMethod: GeneratedClientFunction) {
    const { responseBodySchema, mergedRequestSchema, requestBodySchema, pathParametersSchema, queryParametersSchema } = generatedMethod.method;

    [responseBodySchema, mergedRequestSchema, requestBodySchema, pathParametersSchema, queryParametersSchema].forEach((schema) => {
      if (schema) {
        file.addGeneratedTypeImport(schema.generatedName);
      }
    });
  }

  private generateDataHook(fileForMethod: PluginFile<SourceFile>, generatedMethod: GeneratedClientFunction) {
    const generatorConfig = this.buildGeneratorConfig(fileForMethod, generatedMethod);

    if (!generatorConfig) {
      return;
    }

    // Import the generated client function
    generatorConfig.file.addGeneratedClientImport(generatedMethod.generatedName);

    // Import request/response types
    NormalizedQueryPlugin.addMethodTypeImports(generatorConfig.file, generatedMethod);

    generatorConfig.file.addNodes(
      factory.createJSDocComment(
        `@generated by ${this.name} (${generatedMethod.method.rawMethod.httpMethod} ${generatedMethod.method.rawMethod.httpPath})`,
      ),
      this.generateHook(generatorConfig),
    );
  }

  public async run() {
    for (const file of this.files) {
      for (const [, schema] of this.generatedSchemas) {
        if (file.isFileForSchema(schema)) {
          this.generateEntity(file, schema);
        }
      }

      for (const method of this.generatedClientFunctions) {
        [
          method.method.responseBodySchema,
          method.method.mergedRequestSchema,
          method.method.requestBodySchema,
          method.method.pathParametersSchema,
          method.method.queryParametersSchema,
        ].forEach((schema) => {
          if (schema && file.isFileForSchema(schema)) {
            this.generateResponseEntity(file, schema);
          }
        });

        if (file.isFileForGeneratedClientFunction(method)) {
          this.generateDataHook(file, method);
        }
      }

      if (file.getHasContent()) {
        file.generateHeading();
      }
    }
  }
}
