import { SyntaxKind, ts } from 'ts-morph';
import { match } from 'ts-pattern';
import { createLogicalAndChain, GeneratedClientFunction, GeneratedSchema, ParsedObject } from '@pentops/jsonapi-jdef-ts-generator';
import { MethodGeneratorConfig, RequestEnabledOrGetter } from './config';
import { getRequiredRequestParameters, optionalQuestionToken } from './helpers';
import {
  GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
  REACT_QUERY_INFINITE_QUERY_HOOK_NAME,
  REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME,
  REACT_QUERY_MUTATION_HOOK_NAME,
  REACT_QUERY_QUERY_HOOK_NAME,
} from './constants';
import { buildReactQueryOptionsParameter } from './react-query';

const { factory } = ts;

export function buildQueryFnRequestType(generatedMethod: GeneratedClientFunction) {
  if (generatedMethod.method.mergedRequestSchema) {
    return factory.createTypeReferenceNode(generatedMethod.method.mergedRequestSchema.generatedName);
  }

  return factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword);
}

export function buildRequestEnabled(generatorConfig: MethodGeneratorConfig, requestEnabledOrGetter: RequestEnabledOrGetter) {
  const requiredParameters = getRequiredRequestParameters(generatorConfig);
  const requiredParameterLogicalAnd = createLogicalAndChain(
    requiredParameters?.length
      ? requiredParameters
      : generatorConfig.undefinedRequestForSkip && generatorConfig.parameterNameMap?.merged
        ? [factory.createIdentifier(generatorConfig.parameterNameMap.merged)]
        : [],
  );
  const baseEnabled = requiredParameterLogicalAnd
    ? factory.createCallExpression(factory.createIdentifier('Boolean'), undefined, [requiredParameterLogicalAnd])
    : factory.createTrue();

  return match(requestEnabledOrGetter)
    .with(true, () => factory.createTrue())
    .with(false, () => factory.createFalse())
    .otherwise((r) => {
      if (typeof r === 'function') {
        const out = r(generatorConfig, baseEnabled, requiredParameters);

        if (typeof out === 'boolean') {
          return out ? factory.createTrue() : factory.createFalse();
        }

        return out || factory.createTrue();
      }

      return r || factory.createTrue();
    });
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

export function buildBaseParameters(generatorConfig: MethodGeneratorConfig, undefinedRequestForSkip: boolean) {
  const parameters: ts.ParameterDeclaration[] = [];

  if (generatorConfig.queryHookName !== REACT_QUERY_MUTATION_HOOK_NAME) {
    if (generatorConfig.method.method.mergedRequestSchema) {
      parameters.push(
        buildHookParameterDeclaration(
          GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME,
          generatorConfig.method.method.mergedRequestSchema,
          false,
          undefinedRequestForSkip,
        ),
      );
    }
  }

  parameters.push(buildReactQueryOptionsParameter(generatorConfig));

  return parameters;
}

export function buildQueryFnArgs(generatorConfig: MethodGeneratorConfig): ts.ParameterDeclaration[] {
  switch (generatorConfig.queryHookName) {
    case REACT_QUERY_QUERY_HOOK_NAME:
      return [];
    case REACT_QUERY_MUTATION_HOOK_NAME: {
      const requestType = buildQueryFnRequestType(generatorConfig.method);

      return requestType && requestType.kind !== SyntaxKind.UndefinedKeyword
        ? [factory.createParameterDeclaration(undefined, undefined, GENERATED_HOOK_MERGED_REQUEST_PARAMETER_NAME, undefined, requestType)]
        : [];
    }
    case REACT_QUERY_INFINITE_QUERY_HOOK_NAME: {
      return [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createObjectBindingPattern([factory.createBindingElement(undefined, undefined, REACT_QUERY_INFINITE_QUERY_HOOK_PAGE_PARAM_NAME)]),
        ),
      ];
    }
    default:
      return [];
  }
}
