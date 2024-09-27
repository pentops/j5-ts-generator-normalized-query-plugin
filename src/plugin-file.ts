import { SourceFile } from 'ts-morph';
import { BasePluginFile, IPluginFileConfig } from '@pentops/jsonapi-jdef-ts-generator';
import { NormalizedQueryPlugin } from './plugin';

export type NormalizedQueryPluginFileConfig = IPluginFileConfig<SourceFile>;

export class NormalizedQueryPluginFile extends BasePluginFile<SourceFile, NormalizedQueryPluginFileConfig, NormalizedQueryPlugin> {}
