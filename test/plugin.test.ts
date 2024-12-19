import { APISource, Builder, defaultConfig, IPluginFileConfig, parseApiSource, ParsedMethod } from '@pentops/jsonapi-jdef-ts-generator';
import { SourceFile } from 'ts-morph';
import { describe, it, expect } from 'vitest';
import { match, P } from 'ts-pattern';
import { camelCase, constantCase, kebabCase, pascalCase } from 'change-case';
import { NormalizedQueryPlugin } from '../src';
import rawSource from './mock/api.json';

function typeNameWriter(x: string) {
  return x
    .split(/[./]/)
    .filter((x) => x)
    .map((x) => pascalCase(x))
    .join('');
}

function methodNameWriter(method: ParsedMethod) {
  return method.fullGrpcName
    .split(/[./]/)
    .reduce<string[]>((acc, curr) => {
      if (curr) {
        acc.push(acc.length === 0 ? camelCase(curr) : pascalCase(curr));
      }

      return acc;
    }, [])
    .join('');
}

const hooksToGenerate: Set<string> = new Set();
const entitiesToGenerate: Set<string> = new Set();

describe('NormalizedQueryPlugin', async () => {
  const source = parseApiSource(rawSource as unknown as APISource);

  it('should properly generate entities and hooks from an api.json file', async () => {
    const gen = await new Builder(
      process.cwd(),
      {
        ...defaultConfig,
        dryRun: { log: false },
        typeOutput: {
          directory: './types/generated',
          fileName: 'api.ts',
        },
        clientOutput: {
          directory: './api-client/generated/client-functions',
          fileName: 'index.ts',
        },
        types: {
          enumType: 'enum',
          nameWriter: typeNameWriter,
        },
        client: {
          methodNameWriter,
        },
        plugins: [
          new NormalizedQueryPlugin({
            files: (generatedSchemas, generatedClientFunctions) => {
              const files: IPluginFileConfig<SourceFile>[] = [];

              for (const [, schema] of generatedSchemas) {
                const entity = match(schema.rawSchema)
                  .with({ object: { entity: { primaryKeys: P.not(P.nullish) } } }, (s) => s)
                  .otherwise(() => undefined);

                if (entity) {
                  files.push({
                    clientFunctionFilter: false,
                    directory: './api-client/generated/entities',
                    fileName: `${kebabCase(schema.generatedName)}.ts`,
                    schemaFilter: (s) => {
                      const shouldGenerate = s.generatedName === schema.generatedName;

                      if (shouldGenerate) {
                        entitiesToGenerate.add(schema.generatedName);
                      }

                      return shouldGenerate;
                    },
                  });
                }
              }

              for (const method of generatedClientFunctions) {
                files.push({
                  clientFunctionFilter: (m) => m.generatedName === method.generatedName,
                  directory: './api-client/generated/hooks',
                  fileName: `${kebabCase(method.generatedName)}.ts`,
                  schemaFilter: (s) => {
                    const methodSchemas = [method.method.responseBodySchema?.generatedName, method.method.mergedRequestSchema?.generatedName].filter(
                      Boolean,
                    );

                    const shouldGenerate = Boolean(methodSchemas.length && methodSchemas.includes(s.generatedName));
                    if (shouldGenerate) {
                      hooksToGenerate.add(method.generatedName);
                    }

                    return shouldGenerate;
                  },
                });
              }

              return files;
            },
          }) as any,
        ],
      },
      source,
    ).build();

    expect(gen).toBeDefined();

    const expectedVariableDeclarations = new Set(
      Array.from(entitiesToGenerate).reduce<string[]>((acc, entity) => {
        return [
          ...acc,
          `${constantCase(entity)}_ENTITY_NAME`, // constant for entity name
          `${camelCase(entity)}Entity`, // entity variable name
        ];
      }, []),
    );

    const expectedFnDeclarations = new Set();

    hooksToGenerate.forEach((hook) => {
      const lcHook = hook.toLowerCase();

      // Ensure response entities are generated
      if (!lcHook.endsWith('event') && !lcHook.endsWith('events')) {
        expectedVariableDeclarations.add(`${camelCase(hook)}ResponseEntity`);
      }

      expectedFnDeclarations.add(camelCase(`use-${hook}`));
      expectedFnDeclarations.add(camelCase(`build-${hook}-key`));
    });

    gen?.getSourceFiles().forEach((file) => {
      file.getVariableDeclarations().forEach((v) => {
        expectedVariableDeclarations.delete(v.getName());
      });

      file.getFunctions().forEach((f) => {
        console.log(f.getFullText());
        expectedFnDeclarations.delete(f.getName());
      });
    });

    expect(expectedVariableDeclarations).toEqual(new Set());
    expect(expectedFnDeclarations).toEqual(new Set());
  });
});
