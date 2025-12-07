/*
 * Copyright 2021 The Backstage Authors
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

import { ScmIntegrations } from '@backstage/integration';
import { ConfigReader } from '@backstage/config';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createGithubActionsDispatchAction } from './githubActionsDispatch';
import { mockServices } from '@backstage/backend-test-utils';
import unzipper from 'unzipper';
import { Buffer } from 'buffer';

// Mock octokit
const mockCreateWorkflowDispatch = jest.fn();
const mockListWorkflowRuns = jest.fn();
const mockGetWorkflowRun = jest.fn();
const mockListWorkflowRunArtifacts = jest.fn();
const mockDownloadArtifact = jest.fn();

jest.mock('octokit', () => ({
  Octokit: class {
    rest = {
      actions: {
        createWorkflowDispatch: mockCreateWorkflowDispatch,
        listWorkflowRuns: mockListWorkflowRuns,
        getWorkflowRun: mockGetWorkflowRun,
        listWorkflowRunArtifacts: mockListWorkflowRunArtifacts,
        downloadArtifact: mockDownloadArtifact,
      },
    };
  },
}));

// Mock unzipper
jest.mock('unzipper');
const mockUnzipper = unzipper as jest.Mocked<any>;

const mockFileBuffer = jest.fn();
const mockDirectory = {
  files: [
    { path: 'test.json', buffer: mockFileBuffer },
    { path: 'README.md', buffer: jest.fn() },
  ],
};

describe('github:actions:dispatch', () => {
  const config = new ConfigReader({
    integrations: {
      github: [
        { host: 'github.com', token: 'tokenlols' },
      ],
    },
  });
  const integrations = ScmIntegrations.fromConfig(config);
  const action = createGithubActionsDispatchAction({ integrations });
  const logger = mockServices.logger.mock();
  const now = Date.now();

  const mockRun = {
    id: 12345,
    html_url: 'https://github.com/owner/repo/actions/runs/12345',
    created_at: new Date(now + 20_000).toISOString(),
    status: 'completed',
    conclusion: 'success',
  };

  beforeAll(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick'],
      now,
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockUnzipper.Open.buffer.mockResolvedValue(mockDirectory);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  const baseInput = {
    repoUrl: 'github.com?owner=owner&repo=repo',
    workflowId: 'ci.yml',
    branchOrTagName: 'main',
    initialWaitSeconds: 5,
    pollIntervalSeconds: 10,
    timeoutMinutes: 30,
    waitForCompletion: false,
  };

  it('should dispatch a workflow and not wait', async () => {
    mockListWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [mockRun] },
    });

    const context = createMockActionContext({
      input: baseInput,
    });

    process.nextTick(() => {
      jest.advanceTimersByTime(2_001);
    });
    await action.handler(context);

    expect(mockCreateWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      workflow_id: 'ci.yml',
      ref: 'main',
      inputs: undefined,
    });
    expect(mockListWorkflowRuns).toHaveBeenCalled();
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
    expect(context.output).toHaveBeenCalledWith('runId', mockRun.id);
    expect(context.output).toHaveBeenCalledWith('runUrl', mockRun.html_url);
  });

  it('should wait for completion with success', async () => {
    mockListWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [mockRun] },
    });
    mockGetWorkflowRun
      .mockResolvedValueOnce({ data: { ...mockRun, status: 'in_progress' } })
      .mockResolvedValueOnce({ data: { ...mockRun, status: 'completed' } });

    const context = createMockActionContext({
      input: {
        ...baseInput,
        waitForCompletion: true,
        pollIntervalSeconds: 1,
      },
    });

    process.nextTick(() => {
      jest.advanceTimersByTime(2_001);
    });
    await action.handler(context);
    expect(context.output).toHaveBeenCalledWith('runId', mockRun.id);

    expect(mockGetWorkflowRun).toHaveBeenCalledTimes(2);
    expect(context.output).toHaveBeenCalledWith('runId', mockRun.id);
    expect(context.output).toHaveBeenCalledWith('runUrl', mockRun.html_url);
    expect(context.output).toHaveBeenCalledWith('conclusion', 'success');
  });

  it('should throw if workflow fails', async () => {
    const failedRun = {
      ...mockRun,
      conclusion: 'failure',
    };
    mockListWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [failedRun] },
    });
    mockGetWorkflowRun.mockResolvedValue({ data: failedRun });

    const context = createMockActionContext({
      input: { ...baseInput, waitForCompletion: true },
    });

    await expect(
      action.handler(context)
    ).rejects.toThrow(/Workflow run failed with conclusion: failure/);
  });

  it('should throw on timeout', async () => {
    const inProgressRun = { ...mockRun, status: 'in_progress' };
    mockListWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [inProgressRun] },
    });
    mockGetWorkflowRun.mockResolvedValue({ data: inProgressRun });

    const context = createMockActionContext({
      input: {
        ...baseInput,
        waitForCompletion: true,
        timeoutMinutes: 1,
        pollIntervalSeconds: 30,
      },
    });
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(limit => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), limit);
      return controller.signal;
    });

    const handlerPromise = action.handler(context);
    process.nextTick(() => {
      jest.advanceTimersByTime(60_001);
    });
    await expect(handlerPromise).rejects.toThrow(
      /Timed out waiting for workflow completion after 1 minutes/,
    );
  });

  it('should fetch and parse artifact JSON', async () => {
    const artifact = { id: 678, name: 'my-artifact' };
    const artifactZipData = Buffer.from('zip-file-content');
    const artifactJsonContent = { foo: 'bar' };
    mockFileBuffer.mockResolvedValue(
      Buffer.from(JSON.stringify(artifactJsonContent)),
    );

    mockListWorkflowRuns.mockResolvedValue({
      data: { workflow_runs: [mockRun] },
    });
    mockGetWorkflowRun.mockResolvedValueOnce({ data: { ...mockRun, status: 'completed' } });
    mockListWorkflowRunArtifacts.mockResolvedValue({
      data: { artifacts: [artifact] },
    });
    mockDownloadArtifact.mockResolvedValue({ data: artifactZipData });

    const context = createMockActionContext({
      input: {
        ...baseInput,
        waitForCompletion: true,
        outputArtifactName: 'my-artifact',
      },
    });

    process.nextTick(() => {
      // sometimes the test finishes before the nextTick fires and its
      // inconsistent so ensure that fake timers are mocked before calling
      // to prevent a noisy error (even thought the test still passes)
      if (jest.isMockFunction(setTimeout)) {
        jest.advanceTimersByTime(2_001);
      }
    });
    await action.handler(context);

    expect(mockListWorkflowRunArtifacts).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      run_id: mockRun.id,
    });
    expect(mockDownloadArtifact).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      artifact_id: artifact.id,
      archive_format: 'zip',
    });
    expect(mockUnzipper.Open.buffer).toHaveBeenCalledWith(artifactZipData);
    expect(mockFileBuffer).toHaveBeenCalled();
    expect(context.output).toHaveBeenCalledWith('outputs', artifactJsonContent);
    expect(context.output).toHaveBeenCalledWith('conclusion', 'success');
  });
});
