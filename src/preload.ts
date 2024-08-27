import { match, P } from 'ts-pattern';
import ts, { factory } from 'typescript';
import { getObjectProperties } from '@pentops/jsonapi-jdef-ts-generator';
import { type MethodGeneratorConfig } from './plugin';
import { findEntityPropertyReference, NORMALIZR_ENTITY_GET_ID_METHOD_NAME } from './helpers';

export const NORMALIZED_QUERY_CACHE_IMPORT_PATH = '@pentops/normalized-query-cache';
export const NORMALIZED_QUERY_CACHE_USE_PRELOAD_DATA_HOOK_NAME = 'usePreloadDataFromNormalizedCache';
export const PRELOAD_DATA_VARIABLE_NAME = 'preloadData';

export function buildPreload(generatorConfig: MethodGeneratorConfig, allowStringKeys = true) {
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
          const matchesByPrimaryKey: Map<string, ts.Expression> = new Map();

          for (const primaryKey of r.entity.primaryKeys || []) {
            const matchingProperty = findEntityPropertyReference(
              properties || new Map(),
              s.parameterNames.merged,
              r.entity.entityName,
              primaryKey,
              allowStringKeys,
            );

            if (matchingProperty) {
              matchesByPrimaryKey.set(primaryKey, matchingProperty);
            }
          }

          if (matchesByPrimaryKey.size !== r.entity.primaryKeys?.length) {
            console.warn(
              `[j5-ts-generator-normalized-query-plugin]: could not find all primary keys while building preload for ${r.entity.entityName}. Skipping preload for ${key}. Primary keys: ${r.entity.primaryKeys}`,
            );
          } else {
            const assignments: ts.ObjectLiteralElementLike[] = [];

            for (const [primaryKey, matchingProperty] of matchesByPrimaryKey) {
              if (matchesByPrimaryKey.size === 1) {
                refKeyPreloadObjectLiteralProperties.push(factory.createPropertyAssignment(key, matchingProperty));
              } else {
                assignments.push(factory.createPropertyAssignment(primaryKey, matchingProperty));
              }
            }

            if (assignments.length) {
              refKeyPreloadObjectLiteralProperties.push(
                factory.createPropertyAssignment(
                  key,
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                      factory.createIdentifier(r.entity.entityVariableName),
                      NORMALIZR_ENTITY_GET_ID_METHOD_NAME,
                    ),
                    undefined,
                    [
                      factory.createObjectLiteralExpression(assignments),
                      factory.createObjectLiteralExpression([]),
                      factory.createStringLiteral('', true),
                    ],
                  ),
                ),
              );
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
