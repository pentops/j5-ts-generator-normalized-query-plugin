import { match, P } from 'ts-pattern';
import { getObjectProperties, ParsedSchemaWithRef } from '@pentops/jsonapi-jdef-ts-generator';
import { findMatchingProperty } from './helpers';
import type { MethodGeneratorConfig } from './config';
import { J5_LIST_PAGE_REQUEST_TYPE } from './constants';

export function getPageParameter(requestSchema: ParsedSchemaWithRef | undefined) {
  return findMatchingProperty(getObjectProperties(requestSchema) || new Map(), J5_LIST_PAGE_REQUEST_TYPE);
}

export function findPageParameterForConfig(config: MethodGeneratorConfig) {
  return match(config.method.method)
    .with({ mergedRequestSchema: P.not(P.nullish) }, (r) => getPageParameter(r.mergedRequestSchema?.rawSchema))
    .otherwise(() => undefined);
}
