import { Statement, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import {
  createPropertyAccessChain,
  GeneratedClientFunction,
  getObjectProperties,
  ParsedObjectProperty,
  ParsedSchemaWithRef,
  PropertyAccessPart,
  QueryPart,
} from '@pentops/jsonapi-jdef-ts-generator';
import { MethodGeneratorConfig } from './plugin';

const { factory } = ts;

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
export const REACT_QUERY_PLACEHOLDER_DATA_PARAM_NAME = 'placeholderData';
export const REACT_QUERY_INFINITE_DATA_TYPE_NAME = 'InfiniteData';
export const REACT_QUERY_QUERY_KEY_TYPE_NAME = 'QueryKey';

export function getIsEventMethod(method: GeneratedClientFunction) {
  return method.method.rawMethod.methodType?.stateQuery?.queryPart === QueryPart.ListEvents;
}

export type ReactQueryHookName =
  | typeof REACT_QUERY_QUERY_HOOK_NAME
  | typeof REACT_QUERY_MUTATION_HOOK_NAME
  | typeof REACT_QUERY_INFINITE_QUERY_HOOK_NAME;

export const NORMALIZR_ENTITY_GET_ID_METHOD_NAME = 'getId';

export type MethodParameterName = 'merged';

export function getRequiredRequestParameterNames(generatorConfig: MethodGeneratorConfig) {
  function findRequired(schema: ParsedSchemaWithRef | undefined): string[] {
    const required = new Set<string>();

    for (const [, property] of getObjectProperties(schema) || []) {
      if (property.required) {
        required.add(property.name);
      }
    }

    return Array.from(required);
  }

  return match(generatorConfig)
    .returnType<Partial<Record<MethodParameterName, string[]>>>()
    .with({ parameterNameMap: { merged: P.string } }, (s) => {
      const required = findRequired(s.method.method.mergedRequestSchema?.rawSchema);

      if (required) {
        return { merged: required };
      }

      return {};
    })
    .otherwise(() => ({}));
}

export function getRequiredRequestParameters(generatorConfig: MethodGeneratorConfig) {
  const buildPropertyAccessExpressions = (parameterName: string, requiredProperties: string[]) =>
    requiredProperties.map((propertyName) =>
      factory.createPropertyAccessChain(
        factory.createIdentifier(parameterName),
        generatorConfig.undefinedRequestForSkip ? factory.createToken(SyntaxKind.QuestionDotToken) : undefined,
        propertyName,
      ),
    );

  return match({
    requiredParams: getRequiredRequestParameterNames(generatorConfig),
    parameterNameMap: generatorConfig.parameterNameMap,
  })
    .returnType<ts.PropertyAccessExpression[]>()
    .with({ parameterNameMap: { merged: P.string }, requiredParams: { merged: P.not(P.nullish) } }, (s) =>
      buildPropertyAccessExpressions(s.parameterNameMap.merged, s.requiredParams.merged),
    )
    .otherwise(() => []);
}

export function arrayLiteralAsConst(arrayLiteral: ts.ArrayLiteralExpression) {
  return ts.factory.createAsExpression(arrayLiteral, ts.factory.createTypeReferenceNode('const'));
}

export function returnArrayLiteralAsConst(arrayLiteral: ts.ArrayLiteralExpression) {
  return ts.factory.createReturnStatement(arrayLiteralAsConst(arrayLiteral));
}

export function findMatchingVariableStatement(needle: Statement, haystack: Statement[]) {
  if (needle.isKind(SyntaxKind.VariableStatement)) {
    const needleName = needle.getDeclarations()[0]?.getName();

    for (const searchStatement of haystack) {
      if (searchStatement.isKind(SyntaxKind.VariableStatement)) {
        for (const searchDeclaration of searchStatement.getDeclarations()) {
          if (needleName === searchDeclaration.getName()) {
            return searchStatement;
          }
        }
      }
    }
  } else {
    for (const searchStatement of haystack) {
      if (needle.getText() === searchStatement.getText()) {
        return searchStatement;
      }
    }
  }

  return undefined;
}

export function findEntityPropertyReference(
  properties: Map<string, ParsedObjectProperty>,
  accessVariableName: string,
  entityName: string,
  primaryKey: string,
  allowStringKeys = true,
): ts.PropertyAccessExpression | undefined {
  const parts = primaryKey.split('.');
  let currentProperties = properties;
  const consumedParts: PropertyAccessPart[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];

    if (currentProperties.has(part)) {
      const property = currentProperties.get(part);

      consumedParts.push({
        name: part,
        optional: !property?.required,
      });

      if (property) {
        let keySchema = Boolean(
          match({ allowStringKeys, property })
            .with({ property: { schema: { key: { entity: entityName } } } }, (s) => s)
            .with({ allowStringKeys: true, property: { schema: { string: P.not(P.nullish) } } }, (s) => s)
            .otherwise(() => undefined),
        );

        // Back-up check if there's a matching key that didn't specify an entity
        if (!keySchema) {
          keySchema = Boolean(
            match(property)
              .with({ schema: { key: { entity: P.nullish } } }, (s) => s)
              .otherwise(() => undefined),
          );
        }

        if (keySchema) {
          return createPropertyAccessChain(accessVariableName, true, consumedParts);
        }

        const prospectiveProperties = getObjectProperties(property.schema);

        if (prospectiveProperties?.size) {
          currentProperties = prospectiveProperties;
        } else {
          return undefined;
        }
      }
    } else {
      return undefined;
    }
  }

  return undefined;
}
