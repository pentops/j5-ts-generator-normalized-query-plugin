import { SyntaxKind, ts } from 'ts-morph';
import { match } from 'ts-pattern';
import { MethodGeneratorConfig, ReactQueryHookName } from './config';
import {
  GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME,
  REACT_QUERY_INFINITE_DATA_TYPE_NAME,
  REACT_QUERY_INFINITE_QUERY_HOOK_NAME,
  REACT_QUERY_MUTATION_HOOK_NAME,
  REACT_QUERY_QUERY_HOOK_NAME,
  REACT_QUERY_QUERY_KEY_TYPE_NAME,
} from './constants';
import { optionalQuestionToken } from './helpers';

const { factory } = ts;

export const REACT_QUERY_OPTIONS_TYPE_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'UseQueryOptions',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'UseMutationOptions',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'UseInfiniteQueryOptions',
};

export const REACT_QUERY_FN_KEY_PARAMETER_NAME_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'queryKey',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'queryKey',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'mutationKey',
};

export const REACT_QUERY_FN_PARAMETER_NAME_BY_HOOK_NAME: Record<ReactQueryHookName, string> = {
  [REACT_QUERY_QUERY_HOOK_NAME]: 'queryFn',
  [REACT_QUERY_INFINITE_QUERY_HOOK_NAME]: 'queryFn',
  [REACT_QUERY_MUTATION_HOOK_NAME]: 'mutationFn',
};

export function buildReactQueryOptionsParameter(generatorConfig: MethodGeneratorConfig) {
  const returnType = generatorConfig.method.method.responseBodySchema
    ? factory.createUnionTypeNode([
        factory.createTypeReferenceNode(generatorConfig.method.method.responseBodySchema.generatedName),
        factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
      ])
    : factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword);

  const typeArgs = match(generatorConfig.queryHookName)
    .returnType<ts.TypeNode[]>()
    .with(REACT_QUERY_MUTATION_HOOK_NAME, () => {
      if (generatorConfig.method.method.mergedRequestSchema) {
        return [
          returnType,
          factory.createTypeReferenceNode('Error'),
          factory.createTypeReferenceNode(generatorConfig.method.method.mergedRequestSchema.generatedName),
          factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword),
        ];
      }

      return [
        returnType,
        factory.createTypeReferenceNode('Error'),
        factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
        factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword),
      ];
    })
    .with(REACT_QUERY_INFINITE_QUERY_HOOK_NAME, () => [
      returnType,
      factory.createTypeReferenceNode('Error'),
      factory.createTypeReferenceNode(REACT_QUERY_INFINITE_DATA_TYPE_NAME, [returnType]),
      returnType,
      factory.createTypeReferenceNode(REACT_QUERY_QUERY_KEY_TYPE_NAME),
      factory.createUnionTypeNode([
        factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
        factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
      ]),
    ])
    .otherwise(() => [returnType]);

  return factory.createParameterDeclaration(
    undefined,
    undefined,
    GENERATED_HOOK_REACT_QUERY_OPTIONS_PARAMETER_NAME,
    optionalQuestionToken,
    factory.createTypeReferenceNode('Partial', [factory.createTypeReferenceNode(generatorConfig.queryOptionsTypeName, typeArgs)]),
  );
}
