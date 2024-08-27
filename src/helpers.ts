import { Statement, SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import { getObjectProperties, ParsedObjectProperty } from '@pentops/jsonapi-jdef-ts-generator';

const { factory } = ts;

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

export function createLogicalAndChain(expressions: ts.Expression[]) {
  let logicalAnd: ts.Expression | undefined;

  expressions.forEach((expression) => {
    if (!logicalAnd) {
      logicalAnd = expression;
    } else {
      logicalAnd = factory.createLogicalAnd(logicalAnd, expression);
    }
  });

  return logicalAnd;
}

export interface PropertyAccessPart {
  name: string;
  optional: boolean;
}

export function createPropertyAccessChain(accessor: string, accessorIsOptional: boolean, parts: PropertyAccessPart[]) {
  let accessChain: ts.PropertyAccessExpression | undefined;

  parts.forEach((part, i) => {
    if (!accessChain) {
      accessChain = factory.createPropertyAccessChain(
        factory.createIdentifier(accessor),
        accessorIsOptional ? factory.createToken(ts.SyntaxKind.QuestionDotToken) : undefined,
        part.name,
      );
    } else {
      accessChain = factory.createPropertyAccessChain(
        accessChain,
        parts[i - 1]?.optional ? factory.createToken(ts.SyntaxKind.QuestionDotToken) : undefined,
        part.name,
      );
    }
  });

  return accessChain;
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
