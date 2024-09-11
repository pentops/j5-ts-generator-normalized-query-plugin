import { Statement, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import {
  createPropertyAccessChain,
  GeneratedClientFunction,
  getObjectProperties,
  ParsedObjectProperty,
  ParsedSchemaWithRef,
  PropertyAccessPart,
} from '@pentops/jsonapi-jdef-ts-generator';
import { MethodGeneratorConfig } from './plugin';
import { factory } from 'typescript';

export const NORMALIZR_ENTITY_GET_ID_METHOD_NAME = 'getId';

export type SplitParamName = 'path' | 'query' | 'body';
export type MergedParamName = 'merged';
export type MethodParameterName = SplitParamName | MergedParamName;

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
    .with(
      P.union({ parameterNameMap: { path: P.string } }, { parameterNameMap: { query: P.string } }, { parameterNameMap: { body: P.string } }),
      (s) => {
        const params: Partial<Record<SplitParamName, string[]>> = {};

        if (s.method.method.pathParametersSchema) {
          const required = findRequired(s.method.method.pathParametersSchema.rawSchema);

          if (required) {
            params.path = required;
          }
        }

        if (s.method.method.queryParametersSchema) {
          const required = findRequired(s.method.method.queryParametersSchema.rawSchema);

          if (required) {
            params.query = required;
          }
        }

        if (s.method.method.requestBodySchema) {
          const required = findRequired(s.method.method.requestBodySchema.rawSchema);

          if (required) {
            params.body = required;
          }
        }

        return Object.keys(params).length ? params : {};
      },
    )
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
    .with(
      P.union(
        { parameterNameMap: { path: P.string }, requiredParams: { path: P.not(P.nullish) } },
        { parameterNameMap: { query: P.string }, requiredParams: { query: P.not(P.nullish) } },
        { parameterNameMap: { body: P.string }, requiredParams: { body: P.not(P.nullish) } },
      ),
      (s) => {
        return [
          ...('path' in s.parameterNameMap && 'path' in s.requiredParams
            ? buildPropertyAccessExpressions(s.parameterNameMap.path, s.requiredParams.path)
            : []),
          ...('query' in s.parameterNameMap && 'query' in s.requiredParams
            ? buildPropertyAccessExpressions(s.parameterNameMap.query, s.requiredParams.query)
            : []),
          ...('body' in s.parameterNameMap && 'body' in s.requiredParams
            ? buildPropertyAccessExpressions(s.parameterNameMap.body, s.requiredParams.body)
            : []),
        ];
      },
    )
    .otherwise(() => []);
}

export function guessIsEventMethod(method: GeneratedClientFunction) {
  const lowerCasedName = method.generatedName.toLowerCase();

  return lowerCasedName.endsWith('event') || lowerCasedName.endsWith('events');
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
        const keySchema = match({ allowStringKeys, property })
          .with({ property: { schema: { key: { entity: entityName } } } }, (s) => s)
          .with({ allowStringKeys: true, property: { schema: { string: P.not(P.nullish) } } }, (s) => s)
          .otherwise(() => undefined);

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
