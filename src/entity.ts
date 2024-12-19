import { SyntaxKind, ts } from 'ts-morph';
import { match, P } from 'ts-pattern';
import { GeneratedClientFunction, GeneratedImportPath, type GeneratedSchema, type ParsedObject } from '@pentops/jsonapi-jdef-ts-generator';
import { NORMALIZR_OBJECT_NAME, NORMALIZR_SCHEMA_NAME } from './constants';
import { type NormalizedQueryPluginFile } from './plugin-file';

const { factory } = ts;

export type EntityReferenceDetail = { entity: NormalizerEntity; isArray: boolean };
export type EntityReference = EntityReferenceDetail | { isArray: boolean; schema: Map<string, EntityReference> };

export interface NormalizerEntity extends GeneratedSchema<ParsedObject> {
  entityName: string;
  entityNameConstName?: string;
  entityVariableName: string;
  primaryKeys?: string[];
  importConfig: GeneratedImportPath;
  references?: Map<string, EntityReference>;
}

export function getEntityName(schema: GeneratedSchema) {
  return match(schema.rawSchema)
    .with({ object: { name: P.string } }, (r) => r.object.entity?.stateEntityFullName || r.object.fullGrpcName)
    .with({ oneOf: { name: P.string } }, (r) => r.oneOf.fullGrpcName)
    .with({ enum: { name: P.string } }, (r) => r.enum.fullGrpcName)
    .otherwise(() => schema.generatedName);
}

export function getEntityPrimaryKeys(schema: GeneratedSchema): string[] | undefined {
  return match(schema.rawSchema)
    .with({ object: { entity: { primaryKeys: P.not(P.nullish) } } }, (s) => s.object.entity.primaryKeys)
    .otherwise(() => undefined);
}

export function generateIdAttributeAccessor(entity: NormalizerEntity) {
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

export function buildEntityReferenceMap(entityReferences: Map<string, EntityReference>): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = [];

  for (const [key, value] of entityReferences) {
    const property = match(value)
      .with({ entity: P.not(P.nullish) }, (s) => {
        const baseIdentifier = factory.createIdentifier(s.entity.entityVariableName);
        return factory.createPropertyAssignment(key, s.isArray ? factory.createArrayLiteralExpression([baseIdentifier]) : baseIdentifier);
      })
      .with({ schema: P.not(P.nullish) }, (s) => {
        const normalizrObject = buildNormalizrObject(s.schema);
        return factory.createPropertyAssignment(key, s.isArray ? factory.createArrayLiteralExpression([normalizrObject]) : normalizrObject);
      })
      .otherwise(() => undefined);

    if (property) {
      properties.push(property);
    }
  }

  return factory.createObjectLiteralExpression(properties, true);
}

export function buildNormalizrObject(entityReferences: Map<string, EntityReference>, schemaName?: string) {
  return factory.createNewExpression(
    factory.createPropertyAccessExpression(factory.createIdentifier(NORMALIZR_SCHEMA_NAME), NORMALIZR_OBJECT_NAME),
    schemaName ? [factory.createTypeReferenceNode(schemaName)] : [],
    [buildEntityReferenceMap(entityReferences)],
  );
}

export function getMethodEntityName(generatedMethod: GeneratedClientFunction) {
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

export function getEntityFile(entity: NormalizerEntity, files: NormalizedQueryPluginFile[]) {
  return files.find((file) => file.config.directory === entity.importConfig.directory && file.config.fileName === entity.importConfig.fileName);
}

export function addEntityReferenceImports(
  file: NormalizedQueryPluginFile,
  entityReferences: Map<string, EntityReference>,
  files: NormalizedQueryPluginFile[],
) {
  for (const [, ref] of entityReferences) {
    match(ref)
      .with({ entity: P.not(P.nullish) }, (r) => {
        const entityFile = getEntityFile(r.entity, files);

        if (entityFile && entityFile !== file) {
          file.addImportToOtherGeneratedFile(entityFile, [r.entity.entityVariableName]);
        }
      })
      .with({ schema: P.not(P.nullish) }, (r) => addEntityReferenceImports(file, r.schema, files))
      .otherwise(() => {});
  }
}
