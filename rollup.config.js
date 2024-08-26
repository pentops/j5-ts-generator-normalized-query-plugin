import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const plugins = [typescript(), commonjs(), nodeResolve({ resolveOnly: ['ts-pattern', 'change-case', 'ts-morph'] })];

export default [
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins,
  },
];
