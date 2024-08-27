import { Statement, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import { createPropertyAccessChain, getObjectProperties, ParsedObjectProperty, PropertyAccessPart } from '@pentops/jsonapi-jdef-ts-generator';

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
