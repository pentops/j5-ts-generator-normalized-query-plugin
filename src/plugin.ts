import { SourceFile, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import {
  cleanRefName,
  createLogicalAndChain,
  createPropertyAccessChain,
  GeneratedClientFunction,
  GeneratedSchema,
  getFullGRPCName,
  getObjectProperties,
  ParsedObject,
  ParsedObjectProperty,
  ParsedSchema,
  ParsedSchemaWithRef,
  BasePlugin,
  findSchemaProperties,
  IPluginRunOutput,
  IWritableFile,
} from '@pentops/jsonapi-jdef-ts-generator';
import { isSchemaArray, findMatchingProperty, getRequiredRequestParameters } from './helpers';
import {
  REACT_QUERY_OPTIONS_TYPE_BY_HOOK_NAME,
  REACT_QUERY_FN_KEY_PARAMETER_NAME_BY_HOOK_NAME,
  REACT_QUERY_FN_PARAMETER_NAME_BY_HOOK_NAME,
  REACT_QUERY_OPTIONS_FN_BY_HOOK_NAME,
} from './react-query';
import { buildPreload } from './preload';
import { addMethodTypeImports, NormalizedQueryPluginFile, NormalizedQueryPluginFileConfig } from './plugin-file';
import {
  buildConfig,
  defaultReactQueryKeyGetter,
  defaultReactQueryOptionsBuilderGetter,
  getIsEventMethod,
  MethodGeneratorConfig,
  MethodParameterNameMap,
  NormalizedQueryPluginConfig,
  NormalizedQueryPluginConfigInput,
  ReactQueryOptionsBuilderConfig,
} from './config';
import {
  addEntityReferenceImports,
  buildEntityReferenceMap,
  buildNormalizrObject,
  EntityReference,
  generateIdAttributeAccessor,
  getEntityFile,
  getEntityName,
  getEntityPrimaryKeys,
  NormalizerEntity,
} from './entity';
import { getPageParameter } from './pagination';
import {
  GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME,
  GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
  GENERATED_HOOK_PATH_PARAMETERS_PARAMETER_NAME,
  GENERATED_HOOK_QUERY_PARAMETERS_PARAMETER_NAME,
  GENERATED_HOOK_REQUEST_BODY_PARAMETER_NAME,
  J5_LIST_PAGE_REQUEST_PAGINATION_TOKEN_PARAM_NAME,
  J5_LIST_PAGE_RESPONSE_TYPE,
  J5_LIST_PAGE_RESPONSE_PAGINATION_TOKEN_PARAM_NAME,
  NORMALIZR_ENTITY_NAME,
  NORMALIZR_ID_ATTRIBUTE_PARAM,
  NORMALIZR_IMPORT_PATH,
  NORMALIZR_SCHEMA_NAME,
  PRELOAD_DATA_VARIABLE_NAME,
  REACT_QUERY_INFINITE_QUERY_HOOK_NAME,
  REACT_QUERY_MUTATION_HOOK_NAME,
  REACT_QUERY_QUERY_HOOK_NAME,
  REACT_QUERY_INFINITE_DATA_TYPE_NAME,
  REACT_QUERY_QUERY_KEY_TYPE_NAME,
  REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME,
  REACT_QUERY_IMPORT_PATH,
  REACT_QUERY_META_PARAM_NAME,
  REACT_QUERY_ENABLED_PARAM_NAME,
  REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_PARAM_NAME,
  REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_FN_RESPONSE_PARAM_NAME,
  REACT_QUERY_INFINITE_QUERY_INITIAL_PAGE_PARAM_NAME,
  REACT_QUERY_PLACEHOLDER_DATA_PARAM_NAME,
  GENERATED_HOOK_META_NORMALIZATION_SCHEMA_PARAMETER_NAME,
  PRELOAD_CACHE_PARAM_NAME,
  REACT_QUERY_QUERY_CACHE_TYPE_NAME,
  PRELOAD_CLIENT_VARIABLE_NAME,
  REACT_QUERY_USE_QUERY_CLIENT_HOOK_NAME,
  REACT_QUERY_GET_QUERY_CACHE_METHOD_NAME,
} from './constants';
import { buildBaseParameters, buildQueryFnArgs, buildQueryFnRequestType, buildRequestEnabled } from './hook';

const { factory } = ts;

export class NormalizedQueryPlugin extends BasePlugin<
  SourceFile,
  NormalizedQueryPluginFileConfig,
  NormalizedQueryPluginFile,
  NormalizedQueryPluginConfig
> {
  name = 'NormalizedQueryPlugin';

  constructor(config: NormalizedQueryPluginConfigInput) {
    super(buildConfig(config));
  }

  private generatedEntities: Map<string, NormalizerEntity> = new Map();

  private generateEntity(fileForSchema: NormalizedQueryPluginFile, schema: GeneratedSchema): NormalizerEntity | undefined {
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
    const entityPrimaryKeys = getEntityPrimaryKeys(schema);

    if (!entityPrimaryKeys?.length) {
      return undefined;
    }

    const entityName = getEntityName(schema);
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

    const idAttribute = generateIdAttributeAccessor(generatedEntity);

    if (!idAttribute) {
      return undefined;
    }

    generatedEntity.references = this.findEntityReferences(schema.rawSchema);

    addEntityReferenceImports(fileForSchema, generatedEntity.references, this.files);

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
                  buildEntityReferenceMap(generatedEntity.references),
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
    const getEntityGeneratedSchema = (schema: ParsedSchema): GeneratedSchema | undefined => {
      return match(schema)
        .with({ object: { entity: P.not(P.nullish) } }, (r) => this.generatedSchemas.get(r.object.fullGrpcName))
        .otherwise(() => undefined);
    };

    return match(schema)
      .with({ $ref: P.string }, (r) => {
        const refValue = this.generatedSchemas.get(cleanRefName(r));
        return refValue ? getEntityGeneratedSchema(refValue.rawSchema) : undefined;
      })
      .with({ array: { itemSchema: P.not(P.nullish) } }, (r) => this.getEntityReference(r.array.itemSchema))
      .otherwise((s) => getEntityGeneratedSchema(s));
  }

  private findEntityReferences(schema: ParsedSchemaWithRef): Map<string, EntityReference> {
    const visited = new Set<string>();

    const digForEntityReferences = (properties: Map<string, ParsedObjectProperty>): Map<string, EntityReference> => {
      const subRefs = new Map<string, EntityReference>();

      for (const [propertyName, property] of properties) {
        const fullGrpcName = getFullGRPCName(property.schema);
        const isArray = isSchemaArray(property.schema);
        const entityReference = this.getEntityReference(property.schema);

        if (entityReference) {
          if (!visited.has(fullGrpcName)) {
            visited.add(fullGrpcName);

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
          }
        } else if (fullGrpcName && !visited.has(fullGrpcName)) {
          visited.add(fullGrpcName);
          const subProperties = findSchemaProperties(property.schema, this.generatedSchemas);

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

    return digForEntityReferences(findSchemaProperties(schema, this.generatedSchemas));
  }

  private generateResponseEntity(fileForSchema: NormalizedQueryPluginFile, schema: GeneratedSchema) {
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
      entityName: getEntityName(schema),
      entityVariableName,
      importConfig: fileForSchema.config,
      references: entityReferences,
    };

    addEntityReferenceImports(fileForSchema, entityReferences, this.files);

    this.generatedEntities.set(schema.generatedName, generatedEntity);

    fileForSchema.addNodes(
      factory.createVariableStatement(
        [factory.createModifier(SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(entityVariableName, undefined, undefined, buildNormalizrObject(entityReferences, schema.generatedName))],
          ts.NodeFlags.Const,
        ),
      ),
    );

    return generatedEntity;
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
            const pageProp = match(argName)
              .with(GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME, () =>
                getPageParameter(generatorConfig.method.method.mergedRequestSchema?.rawSchema),
              )
              .otherwise(() => undefined);

            let createdSpreadElement = false;

            if (pageProp) {
              const objectLiteralExpression = factory.createObjectLiteralExpression(
                [
                  factory.createSpreadAssignment(factory.createIdentifier(argName)),
                  factory.createPropertyAssignment(
                    pageProp[0],
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
              );

              if (this.pluginConfig.hook.undefinedRequestForSkip) {
                const requiredParams = createLogicalAndChain(getRequiredRequestParameters(generatorConfig));
                const requestCondition = requiredParams
                  ? requiredParams
                  : factory.createBinaryExpression(
                      factory.createIdentifier(argName),
                      SyntaxKind.BarBarToken,
                      factory.createIdentifier(REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME),
                    );

                args.push(
                  factory.createConditionalExpression(
                    requestCondition,
                    factory.createToken(SyntaxKind.QuestionToken),
                    objectLiteralExpression,
                    factory.createToken(SyntaxKind.ColonToken),
                    factory.createIdentifier('undefined'),
                  ),
                );
              } else {
                args.push(objectLiteralExpression);
              }

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
        const requestType = buildQueryFnRequestType(generatorConfig.method);

        if (requestType.kind === SyntaxKind.UndefinedKeyword) {
          break;
        }

        args.push(
          factory.createIdentifier(generatorConfig.method.method.mergedRequestSchema ? GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME : 'undefined'),
        );

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

  private generateAndAddResponseEntity(generatedMethod: GeneratedClientFunction, clientFnFile: NormalizedQueryPluginFile) {
    if (generatedMethod.method.responseBodySchema) {
      const responseBodyFile = this.getFileForSchema(generatedMethod.method.responseBodySchema);
      const file = responseBodyFile || clientFnFile;

      const responseEntity = this.generateResponseEntity(file, generatedMethod.method.responseBodySchema);

      // Import the new response entity into the client function file
      if (responseEntity && file && file !== clientFnFile) {
        clientFnFile.addImportToOtherGeneratedFile(file, [responseEntity.entityVariableName]);
      }

      return responseEntity;
    }

    return undefined;
  }

  private buildGeneratorConfig(file: NormalizedQueryPluginFile, generatedMethod: GeneratedClientFunction): MethodGeneratorConfig | undefined {
    const queryHookName = this.pluginConfig.hook.reactQueryHookNameGetter(generatedMethod);

    const relatedEntity = generatedMethod.method.relatedEntity?.generatedName
      ? this.generatedEntities.get(generatedMethod.method.relatedEntity.generatedName)
      : undefined;

    const isEvent = getIsEventMethod(generatedMethod);

    if (relatedEntity && !isEvent) {
      const entityFile = getEntityFile(relatedEntity, this.files);

      if (entityFile && entityFile !== file) {
        file.addImportToOtherGeneratedFile(entityFile, [relatedEntity.entityVariableName]);
      }
    }

    const optionsTypeName = REACT_QUERY_OPTIONS_TYPE_BY_HOOK_NAME[queryHookName];

    const reactQueryImports = [queryHookName, optionsTypeName];

    const reactQueryOptionsFnImport = REACT_QUERY_OPTIONS_FN_BY_HOOK_NAME[queryHookName as keyof typeof REACT_QUERY_OPTIONS_FN_BY_HOOK_NAME];

    if (reactQueryOptionsFnImport) {
      reactQueryImports.push(reactQueryOptionsFnImport);
    }

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
      queryOptionsGetter: this.pluginConfig.hook.reactQueryOptionsGetter,
      queryOptionsBuilderFnGetter: this.pluginConfig.hook.reactQueryOptionsBuilderGetter,
      file,
      hookName: this.pluginConfig.hook.nameWriter(generatedMethod),
      queryKeyBuilderName: this.pluginConfig.hook.reactQueryKeyNameWriter(generatedMethod),
      relatedEntity,
      responseEntity: this.generateAndAddResponseEntity(generatedMethod, file),
      undefinedRequestForSkip: Boolean(this.pluginConfig.hook.undefinedRequestForSkip),
      parameterNameMap: match(generatedMethod.method)
        .returnType<MethodParameterNameMap | undefined>()
        .with({ mergedRequestSchema: P.not(P.nullish) }, () => ({
          merged: GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
        }))
        .otherwise(() => undefined),
    };
  }

  private generateDefaultQueryOptions(
    generatorConfig: MethodGeneratorConfig,
    clientFnArgs: ts.Expression[],
    queryKeyBuilder: ts.FunctionDeclaration,
    hasPreload: boolean,
  ) {
    const queryOptions: ts.ObjectLiteralElementLike[] = [
      factory.createPropertyAssignment(
        generatorConfig.queryKeyParameterName,
        this.pluginConfig.hook.reactQueryKeyGetter(
          generatorConfig,
          queryKeyBuilder,
          defaultReactQueryKeyGetter(generatorConfig, queryKeyBuilder, undefined),
        ),
      ),
      factory.createPropertyAssignment(
        generatorConfig.queryFnParameterName,
        factory.createArrowFunction(
          [factory.createModifier(SyntaxKind.AsyncKeyword)],
          undefined,
          buildQueryFnArgs(generatorConfig),
          undefined,
          factory.createToken(SyntaxKind.EqualsGreaterThanToken),
          factory.createCallExpression(factory.createIdentifier(generatorConfig.method.generatedName), undefined, clientFnArgs),
        ),
      ),
    ];

    if (generatorConfig.queryHookName !== REACT_QUERY_MUTATION_HOOK_NAME) {
      queryOptions.push(
        factory.createPropertyAssignment(
          REACT_QUERY_ENABLED_PARAM_NAME,
          buildRequestEnabled(generatorConfig, this.pluginConfig.hook.requestEnabledOrGetter),
        ),
      );
    }

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
      const pageParam = responseProperties ? findMatchingProperty(responseProperties, J5_LIST_PAGE_RESPONSE_TYPE) : undefined;

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
              createPropertyAccessChain(REACT_QUERY_INFINITE_QUERY_GET_NEXT_PAGE_FN_RESPONSE_PARAM_NAME, true, [
                { name: pageParam[0], optional: true },
                { name: J5_LIST_PAGE_RESPONSE_PAGINATION_TOKEN_PARAM_NAME, optional: true },
              ])!,
            ),
          ),
        );

        // Add initialPageParam property
        queryOptions.push(
          factory.createPropertyAssignment(REACT_QUERY_INFINITE_QUERY_INITIAL_PAGE_PARAM_NAME, factory.createIdentifier('undefined')),
        );
      }
    }

    if (hasPreload) {
      queryOptions.push(
        factory.createPropertyAssignment(REACT_QUERY_PLACEHOLDER_DATA_PARAM_NAME, factory.createIdentifier(PRELOAD_DATA_VARIABLE_NAME)),
      );
    }

    const finalOptions = this.pluginConfig.hook.reactQueryOptionsGetter
      ? this.pluginConfig.hook.reactQueryOptionsGetter(generatorConfig, queryOptions)
      : queryOptions;

    finalOptions.push(factory.createSpreadAssignment(factory.createIdentifier(GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME)));

    return queryOptions;
  }

  private generateHook(
    generatorConfig: MethodGeneratorConfig,
    parameters: ts.ParameterDeclaration[],
    baseHead: ts.Statement[],
    callExpression: ts.CallExpression,
  ) {
    const head =
      typeof this.pluginConfig.hook.headOrGetter === 'function'
        ? this.pluginConfig.hook.headOrGetter(generatorConfig, baseHead)
        : (this.pluginConfig.hook.headOrGetter ?? baseHead);

    if (head?.length) {
      head.push(factory.createIdentifier('\n') as unknown as ts.Statement);
    }

    return factory.createFunctionDeclaration(
      [factory.createModifier(SyntaxKind.ExportKeyword)],
      undefined,
      generatorConfig.hookName,
      undefined,
      parameters,
      undefined,
      factory.createBlock([...(head || []), factory.createReturnStatement(callExpression)], true),
    );
  }

  private generateHookWithHelpers(fileForMethod: NormalizedQueryPluginFile, generatedMethod: GeneratedClientFunction) {
    const generatorConfig = this.buildGeneratorConfig(fileForMethod, generatedMethod);

    if (!generatorConfig) {
      return;
    }

    // Import the generated client function
    generatorConfig.file.addGeneratedClientImport(generatedMethod.generatedName);

    // Import request/response types
    addMethodTypeImports(generatorConfig.file, generatedMethod);

    // Create the query key builder
    const queryKeyBuilder = this.pluginConfig.hook.reactQueryKeyBuilderGetter(generatorConfig);

    generatorConfig.file.addNodes(
      factory.createJSDocComment(
        `@generated by ${this.name} (${generatedMethod.method.rawMethod.httpMethod} ${generatedMethod.method.rawMethod.httpPath})`,
      ),
      factory.createIdentifier('\n'),
      queryKeyBuilder,
      factory.createIdentifier('\n'),
    );

    // If it's a query or infinite query hook, generate and add a query option builder function

    const parameters = buildBaseParameters(generatorConfig, Boolean(this.pluginConfig.hook.undefinedRequestForSkip));
    const clientFnArgs = this.buildClientFnArgs(generatorConfig, parameters);

    const preload =
      generatorConfig.queryHookName === REACT_QUERY_QUERY_HOOK_NAME
        ? buildPreload(generatorConfig, this.pluginConfig.allowStringKeyReferences)
        : undefined;

    const queryOptions = this.generateDefaultQueryOptions(generatorConfig, clientFnArgs, queryKeyBuilder, Boolean(preload));

    const hasSeparateOptionsBuilder =
      generatorConfig.queryHookName === REACT_QUERY_QUERY_HOOK_NAME || generatorConfig.queryHookName === REACT_QUERY_INFINITE_QUERY_HOOK_NAME;

    if (hasSeparateOptionsBuilder) {
      const optionBuilderParams: ts.ParameterDeclaration[] = preload
        ? [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              factory.createIdentifier(PRELOAD_CACHE_PARAM_NAME),
              undefined,
              factory.createTypeReferenceNode(REACT_QUERY_QUERY_CACHE_TYPE_NAME),
            ),
            ...parameters,
          ]
        : parameters;
      const defaultOptionsBuilderCalledWith = [...optionBuilderParams.map((p) => p.name as unknown as ts.Expression)];
      const optionsBuilder = generatorConfig.queryOptionsBuilderFnGetter(
        generatorConfig as ReactQueryOptionsBuilderConfig,
        optionBuilderParams,
        queryOptions,
        preload ? [preload] : [],
        defaultOptionsBuilderCalledWith,
        defaultReactQueryOptionsBuilderGetter(
          generatorConfig as ReactQueryOptionsBuilderConfig,
          optionBuilderParams,
          queryOptions,
          preload ? [preload] : [],
          defaultOptionsBuilderCalledWith,
        ),
      );

      if (optionsBuilder?.fnDeclaration?.name?.escapedText) {
        generatorConfig.file.addNodes(
          optionsBuilder?.fnDeclaration,
          factory.createIdentifier('\n'),
          this.generateHook(
            generatorConfig,
            parameters,
            [
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      PRELOAD_CLIENT_VARIABLE_NAME,
                      undefined,
                      undefined,
                      factory.createCallExpression(factory.createIdentifier(REACT_QUERY_USE_QUERY_CLIENT_HOOK_NAME), undefined, []),
                    ),
                    factory.createVariableDeclaration(
                      PRELOAD_CACHE_PARAM_NAME,
                      undefined,
                      undefined,
                      factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                          factory.createIdentifier(PRELOAD_CLIENT_VARIABLE_NAME),
                          REACT_QUERY_GET_QUERY_CACHE_METHOD_NAME,
                        ),
                        undefined,
                        [],
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
            ],
            factory.createCallExpression(factory.createIdentifier(generatorConfig.queryHookName), undefined, [
              factory.createCallExpression(
                factory.createIdentifier(optionsBuilder?.fnDeclaration.name.escapedText),
                undefined,
                optionsBuilder?.calledWithFromHook || [],
              ),
            ]),
          ),
        );

        return;
      }
    }

    generatorConfig.file.addNodes(
      this.generateHook(
        generatorConfig,
        parameters,
        [],
        factory.createCallExpression(factory.createIdentifier(generatorConfig.queryHookName), undefined, [
          factory.createObjectLiteralExpression(queryOptions, true),
        ]),
      ),
    );
  }

  public async run(): Promise<IPluginRunOutput<NormalizedQueryPluginFile>> {
    for (const file of this.files) {
      for (const [, schema] of this.generatedSchemas) {
        if (file.isFileForSchema(schema)) {
          this.generateEntity(file, schema);
        }
      }

      for (const method of this.generatedClientFunctions) {
        [method.method.responseBodySchema, method.method.mergedRequestSchema].forEach((schema) => {
          if (schema && file.isFileForSchema(schema)) {
            this.generateResponseEntity(file, schema);
          }
        });

        if (file.isFileForGeneratedClientFunction(method)) {
          this.generateHookWithHelpers(file, method);
        }
      }

      if (file.getHasContent()) {
        file.generateHeading();
      }
    }

    const out = await this.buildFiles();

    return {
      files: out.reduce<IWritableFile<SourceFile>[]>((acc, curr) => (curr ? [...acc, curr] : acc), []),
    };
  }
}
