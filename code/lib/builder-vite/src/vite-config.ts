import * as path from 'path';
import fs from 'fs';
import { loadConfigFromFile, mergeConfig } from 'vite';
import type {
  ConfigEnv,
  InlineConfig as ViteInlineConfig,
  PluginOption,
  UserConfig as ViteConfig,
} from 'vite';
import viteReact from '@vitejs/plugin-react';
import { codeGeneratorPlugin } from './code-generator-plugin';
import { stringifyProcessEnvs } from './envs';
import { injectExportOrderPlugin } from './inject-export-order-plugin';
import { mdxPlugin } from './plugins/mdx-plugin';
import { noFouc } from './plugins/no-fouc';
import type { ExtendedOptions, EnvsRaw } from './types';

export type PluginConfigType = 'build' | 'development';

export function readPackageJson(): Record<string, any> | false {
  const packageJsonPath = path.resolve('package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const jsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  return JSON.parse(jsonContent);
}

const configEnvServe: ConfigEnv = {
  mode: 'development',
  command: 'serve',
  ssrBuild: false,
};

const configEnvBuild: ConfigEnv = {
  mode: 'production',
  command: 'build',
  ssrBuild: false,
};

// Vite config that is common to development and production mode
export async function commonConfig(
  options: ExtendedOptions,
  _type: PluginConfigType
): Promise<ViteInlineConfig> {
  const { presets } = options;
  const configEnv = _type === 'development' ? configEnvServe : configEnvBuild;

  const { config: userConfig = {} } = (await loadConfigFromFile(configEnv)) ?? {};

  const sbConfig = {
    configFile: false,
    cacheDir: 'node_modules/.vite-storybook',
    root: path.resolve(options.configDir, '..'),
    plugins: await pluginConfig(options),
    // If an envPrefix is specified in the vite config, add STORYBOOK_ to it,
    // otherwise, add VITE_ and STORYBOOK_ so that vite doesn't lose its default.
    envPrefix: userConfig.envPrefix ? 'STORYBOOK_' : ['VITE_', 'STORYBOOK_'],
  };

  const config: ViteConfig = mergeConfig(userConfig, sbConfig);

  // Sanitize environment variables if needed
  const envsRaw = await presets.apply<Promise<EnvsRaw>>('env');
  if (Object.keys(envsRaw).length) {
    // Stringify env variables after getting `envPrefix` from the  config
    const envs = stringifyProcessEnvs(envsRaw, config.envPrefix);
    config.define = {
      ...config.define,
      ...envs,
    };
  }

  return config;
}

export async function pluginConfig(options: ExtendedOptions) {
  const { presets } = options;
  const framework = await presets.apply('framework', '', options);
  const frameworkName: string = typeof framework === 'object' ? framework.name : framework;
  const svelteOptions: Record<string, any> = await presets.apply('svelteOptions', {}, options);

  const plugins = [
    codeGeneratorPlugin(options),
    // sourceLoaderPlugin(options),
    mdxPlugin(options),
    noFouc(),
    injectExportOrderPlugin,
  ] as PluginOption[];

  // We need the react plugin here to support MDX in non-react projects.
  if (frameworkName !== '@storybook/react-vite') {
    plugins.push(viteReact());
  }

  if (frameworkName === 'svelte') {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const { loadSvelteConfig } = require('@sveltejs/vite-plugin-svelte');
    const config = { ...loadSvelteConfig(), ...svelteOptions };

    try {
      // eslint-disable-next-line global-require
      const csfPlugin = require('./svelte/csf-plugin').default;
      plugins.push(csfPlugin(config));
    } catch (err) {
      // Not all projects use `.stories.svelte` for stories, and by default 6.5+ does not auto-install @storybook/addon-svelte-csf.
      // If it's any other kind of error, re-throw.
      if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    }

    const { svelteDocgen } = await import('./plugins/svelte-docgen');
    plugins.push(svelteDocgen(config));
  }

  if (frameworkName === 'preact') {
    // eslint-disable-next-line global-require
    plugins.push(require('@preact/preset-vite').default());
  }

  if (frameworkName === 'glimmerx') {
    // eslint-disable-next-line global-require, import/extensions
    const plugin = require('vite-plugin-glimmerx/index.cjs');
    plugins.push(plugin.default());
  }

  return plugins;
}
