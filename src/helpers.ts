import { Statement, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import {
  createPropertyAccessChain,
  GeneratedSchema,
  getFullGRPCName,
  getImportPath,
  getObjectProperties,
  ParsedObject,
  ParsedObjectProperty,
  ParsedSchemaWithRef,
  PropertyAccessPart,
} from '@pentops/jsonapi-jdef-ts-generator';
import type { NormalizedQueryPluginFile } from './plugin-file';
import { MethodGeneratorConfig, MethodParameterName } from './config';

const { factory } = ts;

export const optionalQuestionToken = factory.createToken(SyntaxKind.QuestionToken);

export function findMatchingProperty(properties: Map<string, ParsedObjectProperty>, fullGrpcName: string) {
  for (const entry of properties || []) {
    if (getFullGRPCName(entry[1].schema) === fullGrpcName) {
      return entry;
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
              .with({ schema: { key: { primary: true } } }, (s) => s)
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

export function getImportPathForGeneratedFiles(from: NormalizedQueryPluginFile, to: NormalizedQueryPluginFile) {
  return getImportPath(to.config.directory, to.config.fileName, from.config.directory, from.config.fileName);
}

export function isSchemaArray(schema: ParsedSchemaWithRef) {
  return Boolean(schema && 'array' in schema && schema.array);
}

export function buildHookParameterDeclaration(
  parameterName: string,
  schema: GeneratedSchema<ParsedObject>,
  addedNonOptionalParameter: boolean,
  nullable?: boolean,
) {
  let hasARequiredParameter = false;

  for (const [, value] of schema.rawSchema.object.properties) {
    if (value.required) {
      hasARequiredParameter = true;
      break;
    }
  }

  const baseTypeReference = factory.createTypeReferenceNode(schema.generatedName);

  return factory.createParameterDeclaration(
    undefined,
    undefined,
    parameterName,
    hasARequiredParameter || addedNonOptionalParameter ? undefined : optionalQuestionToken,
    nullable ? factory.createUnionTypeNode([baseTypeReference, factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)]) : baseTypeReference,
  );
}

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
