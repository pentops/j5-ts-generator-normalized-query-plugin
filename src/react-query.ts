import type { ReactQueryHookName } from './config';
import { REACT_QUERY_INFINITE_QUERY_HOOK_NAME, REACT_QUERY_MUTATION_HOOK_NAME, REACT_QUERY_QUERY_HOOK_NAME } from './constants';

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
