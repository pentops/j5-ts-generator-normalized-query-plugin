import { match, P } from 'ts-pattern';
import ts, { factory } from 'typescript';
import { getObjectProperties } from '@pentops/jsonapi-jdef-ts-generator';
import { type MethodGeneratorConfig } from './plugin';
import { findEntityPropertyReference } from './helpers';

export const NORMALIZED_QUERY_CACHE_IMPORT_PATH = '@pentops/normalized-query-cache';
export const NORMALIZED_QUERY_CACHE_USE_PRELOAD_DATA_HOOK_NAME = 'usePreloadDataFromNormalizedCache';
export const PRELOAD_DATA_VARIABLE_NAME = 'preloadData';

export function buildPreload(generatorConfig: MethodGeneratorConfig) {
  if (!generatorConfig.method.method.responseBodySchema || !generatorConfig.responseEntity?.references?.size) {
    return undefined;
  }

  const refKeyUnionTypeNodes: ts.TypeNode[] = [];
  const refKeyPreloadObjectLiteralProperties: ts.ObjectLiteralElementLike[] = [];

  for (const [key, ref] of generatorConfig.responseEntity.references) {
    match(ref).with({ entity: P.not(P.nullish) }, (r) => {
      refKeyUnionTypeNodes.push(factory.createLiteralTypeNode(factory.createStringLiteral(key, true)));

      match({ method: generatorConfig.method.method, parameterNames: generatorConfig.parameterNameMap })
        .with({ method: { mergedRequestSchema: P.not(P.nullish) }, parameterNames: { merged: P.string } }, (s) => {
          const properties = getObjectProperties(s.method.mergedRequestSchema.rawSchema);

          for (const primaryKey of r.entity.primaryKeys || []) {
            const matchingProperty = findEntityPropertyReference(properties || new Map(), s.parameterNames.merged, r.entity.entityName, primaryKey);

            if (matchingProperty) {
              refKeyPreloadObjectLiteralProperties.push(factory.createPropertyAssignment(key, matchingProperty));
            }
          }
        })
        // TODO: handle split params
        // .with(
        //   P.union({ pathParametersSchema: P.not(P.nullish) }, { queryParametersSchema: P.not(P.nullish) }, {requestBodySchema: P.not(P.nullish)}),
        //   (s) => {},
        // )
        .otherwise(() => undefined);
    });
  }

  if (!refKeyPreloadObjectLiteralProperties.length) {
    return undefined;
  }

  generatorConfig.file.addManualImport(NORMALIZED_QUERY_CACHE_IMPORT_PATH, [NORMALIZED_QUERY_CACHE_USE_PRELOAD_DATA_HOOK_NAME]);

  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          PRELOAD_DATA_VARIABLE_NAME,
          undefined,
          undefined,
          factory.createCallExpression(
            factory.createIdentifier(NORMALIZED_QUERY_CACHE_USE_PRELOAD_DATA_HOOK_NAME),
            [
              factory.createTypeReferenceNode(generatorConfig.method.method.responseBodySchema.generatedName),
              factory.createUnionTypeNode(refKeyUnionTypeNodes),
            ],
            [
              factory.createIdentifier(generatorConfig.responseEntity.entityVariableName),
              factory.createObjectLiteralExpression(refKeyPreloadObjectLiteralProperties),
            ],
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}
