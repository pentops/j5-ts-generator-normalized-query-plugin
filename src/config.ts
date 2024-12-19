import { Project, SourceFile, Statement, SyntaxKind, ts } from 'ts-morph';
import { camelCase, constantCase } from 'change-case';
import { match, P } from 'ts-pattern';
import {
  GeneratedClientFunction,
  GeneratedSchema,
  IPluginConfig,
  Optional,
  ParsedAuthType,
  PluginEventHandlers,
  QueryPart,
} from '@pentops/jsonapi-jdef-ts-generator';
import { NormalizedQueryPluginFile, pluginFileReader } from './plugin-file';
import { getMethodEntityName, NormalizerEntity } from './entity';
import { findPageParameterForConfig } from './pagination';
import {
  GENERATED_HOOK_QUERY_KEY_GETTER_REST_NAME,
  J5_LIST_PAGE_RESPONSE_TYPE,
  NORMALIZR_SCHEMA_KEY_PARAM,
  REACT_QUERY_INFINITE_QUERY_HOOK_NAME,
  REACT_QUERY_MUTATION_HOOK_NAME,
  REACT_QUERY_QUERY_HOOK_NAME,
} from './constants';
import { arrayLiteralAsConst, findMatchingVariableStatement, returnArrayLiteralAsConst } from './helpers';

const { factory } = ts;

export type StatementConflictHandler = (newSource: Statement | undefined, existingSource: Statement | undefined) => Statement | undefined;

export const defaultStatementConflictHandler: StatementConflictHandler = (newSource) => newSource;

export type MethodParameterNameMap = { merged: string };

export interface MethodGeneratorConfig {
  auth: ParsedAuthType | undefined;
  method: GeneratedClientFunction;
  queryHookName: ReactQueryHookName;
  queryOptionsTypeName: string;
  queryKeyParameterName: string;
  queryFnParameterName: string;
  queryOptionsGetterFnName: string;
  hookName: string;
  file: NormalizedQueryPluginFile;
  relatedEntity?: NormalizerEntity;
  responseEntity?: NormalizerEntity;
  parameterNameMap?: MethodParameterNameMap;
  queryKeyBuilderName: string;
  undefinedRequestForSkip: boolean;
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

export const defaultRequestEnabledOrGetter: RequestEnabledOrGetter = (_, defaultEnabledExpression) => defaultEnabledExpression;

export type RequestInitOrGetter = ts.Expression | undefined | ((config: MethodGeneratorConfig) => ts.Expression | undefined);

export const defaultRequestInitOrGetter: RequestInitOrGetter = undefined;

export type HookNameWriter = (generatedMethod: GeneratedClientFunction) => string;

export const defaultHookNameWriter: HookNameWriter = (generatedMethod: GeneratedClientFunction) => camelCase(`use-${generatedMethod.generatedName}`);

export type KeyBuilderNameWriter = (generatedMethod: GeneratedClientFunction) => string;

export type ReactQueryHookNameGetter = (generatedMethod: GeneratedClientFunction) => ReactQueryHookName;

export const defaultGetMethodReactQueryHookName: ReactQueryHookNameGetter = (generatedMethod) => {
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
};

export type ReactQueryKeyGetter = (
  config: MethodGeneratorConfig,
  generatedKeyBuilder: ts.FunctionDeclaration | undefined,
  defaultKey: ts.Expression | undefined,
) => ts.Expression;

export const defaultReactQueryKeyGetter: ReactQueryKeyGetter = (config, generatedKeyBuilder, defaultKey) => {
  if (defaultKey) {
    return defaultKey;
  }

  if (generatedKeyBuilder) {
    return factory.createCallExpression(
      factory.createIdentifier(config.queryKeyBuilderName),
      undefined,
      match(config)
        .with(
          {
            queryHookName: P.not(REACT_QUERY_MUTATION_HOOK_NAME),
            parameterNameMap: { merged: P.string },
            method: { method: { mergedRequestSchema: P.not(P.nullish) } },
          },
          (s) => [factory.createIdentifier(s.parameterNameMap.merged)],
        )
        .otherwise(() => []),
    );
  }

  return arrayLiteralAsConst(
    factory.createArrayLiteralExpression([
      config.relatedEntity
        ? factory.createPropertyAccessExpression(
            factory.createIdentifier(config.relatedEntity.entityVariableName),
            factory.createIdentifier(NORMALIZR_SCHEMA_KEY_PARAM),
          )
        : factory.createStringLiteral(getMethodEntityName(config.method), true),
    ]),
  );
};

export const defaultKeyBuilderNameWriter: KeyBuilderNameWriter = (generatedMethod) => camelCase(`build-${generatedMethod.generatedName}-key`);

export type ReactQueryKeyBuilderGetter = (config: MethodGeneratorConfig) => ts.FunctionDeclaration;

export const defaultReactQueryKeyBuilderGetter: ReactQueryKeyBuilderGetter = (config) => {
  const entityIdVariableName = 'entityId';

  const parameterDeclarations: ts.ParameterDeclaration[] = match(config)
    .with({ queryHookName: REACT_QUERY_MUTATION_HOOK_NAME }, () => [])
    .with({ parameterNameMap: { merged: P.string }, method: { method: { mergedRequestSchema: P.not(P.nullish) } } }, (s) => [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier(s.parameterNameMap.merged),
        factory.createToken(SyntaxKind.QuestionToken),
        factory.createTypeReferenceNode(s.method.method.mergedRequestSchema.generatedName),
      ),
    ])
    .otherwise(() => []);

  const variableStatements: ts.VariableStatement[] = match(config)
    .with({ queryHookName: REACT_QUERY_MUTATION_HOOK_NAME }, () => [])
    .with({ queryHookName: REACT_QUERY_INFINITE_QUERY_HOOK_NAME, parameterNameMap: { merged: P.string } }, (s) => {
      const pageProp = findPageParameterForConfig(config);

      if (!pageProp) {
        return [];
      }

      return [
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createObjectBindingPattern([
                  factory.createBindingElement(undefined, undefined, pageProp[0]),
                  factory.createBindingElement(factory.createToken(SyntaxKind.DotDotDotToken), undefined, GENERATED_HOOK_QUERY_KEY_GETTER_REST_NAME),
                ]),
                undefined,
                undefined,
                factory.createBinaryExpression(
                  factory.createIdentifier(s.parameterNameMap.merged),
                  ts.SyntaxKind.BarBarToken,
                  factory.createObjectLiteralExpression(),
                ),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
      ];
    })
    .with(
      {
        queryHookName: REACT_QUERY_QUERY_HOOK_NAME,
        parameterNameMap: { merged: P.string },
        method: { method: { mergedRequestSchema: P.not(P.nullish) } },
      },
      (s) => {
        if (!getIsEventMethod(s.method) && s.relatedEntity) {
          return [
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    entityIdVariableName,
                    undefined,
                    undefined,
                    factory.createCallExpression(
                      factory.createPropertyAccessExpression(
                        factory.createIdentifier(s.relatedEntity.entityVariableName),
                        NORMALIZR_ENTITY_GET_ID_METHOD_NAME,
                      ),
                      undefined,
                      [
                        factory.createBinaryExpression(
                          factory.createIdentifier(s.parameterNameMap.merged),
                          ts.SyntaxKind.BarBarToken,
                          factory.createObjectLiteralExpression(),
                        ),
                        factory.createObjectLiteralExpression(),
                        factory.createStringLiteral('', true),
                      ],
                    ),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
          ];
        }

        return [];
      },
    )
    .otherwise(() => []);

  const entityKeyExpression = match(config)
    .with({ queryHookName: REACT_QUERY_MUTATION_HOOK_NAME }, () =>
      factory.createStringLiteral(config.method.method.rawMethod.fullGrpcName || getMethodEntityName(config.method), true),
    )
    .with({ relatedEntity: P.not(P.nullish) }, (s) => {
      if (getIsEventMethod(s.method)) {
        return s.method.method.rootEntitySchema
          ? factory.createStringLiteral(s.method.method.rootEntitySchema.generatedName, true)
          : factory.createStringLiteral(s.method.method.rawMethod.fullGrpcName, true);
      }

      return factory.createPropertyAccessExpression(
        factory.createIdentifier(s.relatedEntity.entityVariableName),
        factory.createIdentifier(NORMALIZR_SCHEMA_KEY_PARAM),
      );
    })
    .otherwise((s) => {
      if (getIsEventMethod(s.method)) {
        return s.method.method.rootEntitySchema
          ? factory.createStringLiteral(s.method.method.rootEntitySchema.generatedName, true)
          : factory.createStringLiteral(s.method.method.rawMethod.fullGrpcName, true);
      }

      return s.relatedEntity
        ? factory.createPropertyAccessExpression(
            factory.createIdentifier(s.relatedEntity.entityVariableName),
            factory.createIdentifier(NORMALIZR_SCHEMA_KEY_PARAM),
          )
        : factory.createStringLiteral(getMethodEntityName(s.method), true);
    });

  const baseReturnValue = returnArrayLiteralAsConst(factory.createArrayLiteralExpression([entityKeyExpression], false));

  const statements: ts.Statement[] = match(config)
    .returnType<ts.Statement[]>()
    .with(
      {
        queryHookName: REACT_QUERY_QUERY_HOOK_NAME,
        parameterNameMap: { merged: P.string },
        method: { method: { mergedRequestSchema: P.not(P.nullish) } },
      },
      (s) => {
        const detailName = factory.createStringLiteral('detail', true);
        const isEventMethod = getIsEventMethod(s.method);

        if (!isEventMethod) {
          if (s.relatedEntity) {
            return [
              ...variableStatements,
              factory.createIfStatement(
                factory.createIdentifier(entityIdVariableName),
                returnArrayLiteralAsConst(
                  factory.createArrayLiteralExpression([entityKeyExpression, detailName, factory.createIdentifier(entityIdVariableName)]),
                ),
              ),
              baseReturnValue,
            ];
          }
        }

        // If it's an event method, add the detail key and request
        return [
          ...variableStatements,
          returnArrayLiteralAsConst(
            factory.createArrayLiteralExpression([entityKeyExpression, detailName, factory.createIdentifier(s.parameterNameMap.merged)]),
          ),
        ];
      },
    )
    .with(
      {
        queryHookName: REACT_QUERY_INFINITE_QUERY_HOOK_NAME,
        parameterNameMap: { merged: P.string },
        method: { method: { mergedRequestSchema: P.not(P.nullish) } },
      },
      (s) => {
        const listName = factory.createStringLiteral('list', true);
        const reqKeyName = Boolean(findPageParameterForConfig(config)?.length)
          ? GENERATED_HOOK_QUERY_KEY_GETTER_REST_NAME
          : s.parameterNameMap.merged;

        if (reqKeyName) {
          return [
            ...variableStatements,
            factory.createIfStatement(
              factory.createIdentifier(reqKeyName),
              returnArrayLiteralAsConst(factory.createArrayLiteralExpression([entityKeyExpression, listName, factory.createIdentifier(reqKeyName)])),
            ),
            returnArrayLiteralAsConst(factory.createArrayLiteralExpression([entityKeyExpression, listName])),
          ];
        }

        return [...variableStatements, baseReturnValue];
      },
    )
    .otherwise(() => [...variableStatements, baseReturnValue]);

  return factory.createFunctionDeclaration(
    [factory.createModifier(SyntaxKind.ExportKeyword)],
    undefined,
    config.queryKeyBuilderName,
    undefined,
    parameterDeclarations,
    undefined,
    factory.createBlock(statements),
  );
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

export type ReactQueryOptionsGetterFnNameWriter = (generatedHookName: string, method: GeneratedClientFunction) => string;

export const defaultReactQueryOptionsGetterFnNameWriter: ReactQueryOptionsGetterFnNameWriter = (generatedHookName) =>
  camelCase(`build-${generatedHookName}-Query-Options`);

export function getIsEventMethod(method: GeneratedClientFunction) {
  return method.method.rawMethod.methodType?.stateQuery?.queryPart === QueryPart.ListEvents;
}

export type ReactQueryHookName =
  | typeof REACT_QUERY_QUERY_HOOK_NAME
  | typeof REACT_QUERY_MUTATION_HOOK_NAME
  | typeof REACT_QUERY_INFINITE_QUERY_HOOK_NAME;

export const NORMALIZR_ENTITY_GET_ID_METHOD_NAME = 'getId';

export type MethodParameterName = 'merged';

export interface NormalizedQueryPluginConfig extends IPluginConfig<NormalizedQueryPluginFile> {
  allowStringKeyReferences?: boolean;
  entity: {
    nameWriter: EntityNameWriter;
    schemaNameConstNameWriter: EntitySchemaNameConstNameWriter;
  };
  hook: {
    baseUrlOrGetter: BaseUrlOrGetter;
    headOrGetter: HookHeadOrGetter;
    nameWriter: HookNameWriter;
    reactQueryHookNameGetter: ReactQueryHookNameGetter;
    reactQueryKeyBuilderGetter: ReactQueryKeyBuilderGetter;
    reactQueryKeyGetter: ReactQueryKeyGetter;
    reactQueryKeyNameWriter: KeyBuilderNameWriter;
    reactQueryOptionsGetter: ReactQueryOptionsGetter;
    reactQueryOptionsGetterFnNameWriter: ReactQueryOptionsGetterFnNameWriter;
    requestEnabledOrGetter: RequestEnabledOrGetter;
    requestInitOrGetter: RequestInitOrGetter;
    undefinedRequestForSkip?: boolean;
  };
  statementConflictHandler: StatementConflictHandler;
}

export type NormalizedQueryPluginHookConfigInput = Partial<NormalizedQueryPluginConfig['hook']>;

export type NormalizedQueryPluginEntityConfigInput = Partial<NormalizedQueryPluginConfig['entity']>;

export type NormalizedQueryPluginConfigInput = Optional<
  Omit<NormalizedQueryPluginConfig, 'hook' | 'entity' | 'defaultExistingFileReader' | 'hooks'> & {
    hook?: NormalizedQueryPluginHookConfigInput;
    entity?: NormalizedQueryPluginEntityConfigInput;
  },
  'entity' | 'hook' | 'statementConflictHandler'
>;

function getPostBuildHook(baseConfig: NormalizedQueryPluginConfig) {
  const mergedPostBuildHook: PluginEventHandlers<NormalizedQueryPluginFile>['postBuildFile'] = async ({ file, builtFile }) => {
    const { content } = builtFile;

    let existingFileContent: SourceFile | undefined;

    try {
      existingFileContent = (await file.pollForExistingFileContent())?.content;
    } catch {}

    if (!existingFileContent) {
      return content;
    }

    // Check for existing content and merge it with the new content
    const newFileAsSourceFile = new Project({ useInMemoryFileSystem: true }).createSourceFile(builtFile.fileName, content);

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

export function buildConfig(config: NormalizedQueryPluginConfigInput) {
  const baseConfig: Omit<NormalizedQueryPluginConfig, 'hooks'> = {
    ...config,
    allowStringKeyReferences: config.allowStringKeyReferences ?? true,
    entity: {
      nameWriter: config.entity?.nameWriter ?? defaultEntityNameWriter,
      schemaNameConstNameWriter: config.entity?.schemaNameConstNameWriter ?? defaultEntitySchemaNameConstNameWriter,
    },
    hook: {
      ...config.hook,
      baseUrlOrGetter: config.hook?.baseUrlOrGetter ?? defaultBaseUrlOrGetter,
      headOrGetter: config.hook?.headOrGetter ?? defaultHookHeaderOrGetter,
      nameWriter: config.hook?.nameWriter ?? defaultHookNameWriter,
      undefinedRequestForSkip: config.hook?.undefinedRequestForSkip ?? true,
      requestEnabledOrGetter: config.hook?.requestEnabledOrGetter ?? defaultRequestEnabledOrGetter,
      reactQueryHookNameGetter: config.hook?.reactQueryHookNameGetter ?? defaultGetMethodReactQueryHookName,
      reactQueryKeyNameWriter: config.hook?.reactQueryKeyNameWriter ?? defaultKeyBuilderNameWriter,
      reactQueryKeyGetter: config.hook?.reactQueryKeyGetter ?? defaultReactQueryKeyGetter,
      reactQueryKeyBuilderGetter: config.hook?.reactQueryKeyBuilderGetter ?? defaultReactQueryKeyBuilderGetter,
      reactQueryOptionsGetter: config.hook?.reactQueryOptionsGetter ?? defaultReactQueryOptionsGetter,
      reactQueryOptionsGetterFnNameWriter: config.hook?.reactQueryOptionsGetterFnNameWriter ?? defaultReactQueryOptionsGetterFnNameWriter,
      requestInitOrGetter: config.hook?.requestInitOrGetter || defaultRequestInitOrGetter,
    },
    defaultExistingFileReader: pluginFileReader,
    statementConflictHandler: config.statementConflictHandler || defaultStatementConflictHandler,
  };

  return {
    ...baseConfig,
    hooks: {
      postBuildFile: getPostBuildHook(baseConfig),
    },
  };
}
