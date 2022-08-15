/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createBackendModule,
  loggerToWinstonLogger,
  configServiceRef,
  loggerServiceRef,
  schedulerServiceRef,
  createServiceRef,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { TaskScheduleDefinition } from '@backstage/backend-tasks';
import {
  DefaultGithubCredentialsProvider,
  GithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { GitHubEntityProvider } from './providers/GitHubEntityProvider';

export const githubCredentialProviderServiceRef =
  createServiceRef<GithubCredentialsProvider>({
    id: 'github.credentialsProvider',
    defaultFactory: async service =>
      createServiceFactory({
        service,
        deps: {
          configFactory: configServiceRef,
        },
        factory: async ({ configFactory }) => {
          const config = await configFactory('root');
          const integrations = ScmIntegrations.fromConfig(config);
          return async () => {
            return DefaultGithubCredentialsProvider.fromIntegrations(
              integrations,
            );
          };
        },
      }),
  });

/**
 * Path forward:
 *
 * - Don't be afraid to create -node packages
 * - Implement default factories
 *    - Duplication should be handled by creating duplicate implementations, which should be fine
 * - Define catalog client service in @backstage/plugin-catalog-node
 */

/**
 * Options for {@link githubEntityProviderCatalogModule}.
 *
 * @alpha
 */
export type GithubEntityProviderCatalogModuleOptions = {
  schedule?: TaskScheduleDefinition;
};

/**
 * Registers the GitHubEntityProvider with the catalog processing extension point.
 *
 * @alpha
 */
export const githubEntityProviderCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'github-entity-provider',
  register(env, options?: GithubEntityProviderCatalogModuleOptions) {
    env.registerInit({
      deps: {
        config: configServiceRef,
        catalog: catalogProcessingExtensionPoint,
        logger: loggerServiceRef,
        scheduler: schedulerServiceRef,
      },
      async init({ config, catalog, logger, scheduler }) {
        const scheduleDef = options?.schedule ?? {
          frequency: { seconds: 600 },
          timeout: { seconds: 900 },
          initialDelay: { seconds: 3 },
        };

        catalog.addEntityProvider(
          GitHubEntityProvider.fromConfig(config, {
            logger: loggerToWinstonLogger(logger),
            schedule: scheduler.createScheduledTaskRunner(scheduleDef),
          }),
        );
      },
    });
  },
});
