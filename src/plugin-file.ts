import { Project, SourceFile } from 'ts-morph';
import { BasePluginFile, GeneratedClientFunction, GeneratorFileReader, IPluginFileConfig } from '@pentops/jsonapi-jdef-ts-generator';
import { NormalizedQueryPlugin } from './plugin';

export type NormalizedQueryPluginFileConfig = IPluginFileConfig<SourceFile>;

export class NormalizedQueryPluginFile extends BasePluginFile<SourceFile, NormalizedQueryPluginFileConfig, NormalizedQueryPlugin> {}

export const pluginFileReader: GeneratorFileReader<SourceFile> = async (filePath) => {
  try {
    return new Project({ useInMemoryFileSystem: true }).addSourceFileAtPath(filePath);
  } catch {
    return undefined;
  }
};

export function addMethodTypeImports(file: NormalizedQueryPluginFile, generatedMethod: GeneratedClientFunction) {
  const { responseBodySchema, mergedRequestSchema } = generatedMethod.method;

  [responseBodySchema, mergedRequestSchema].forEach((schema) => {
    if (schema) {
      file.addGeneratedTypeImport(schema.generatedName);
    }
  });
}
