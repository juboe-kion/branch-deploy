import * as core from '@actions/core'
import {lock} from '../../src/functions/lock'
import * as actionStatus from '../../src/functions/action-status'

class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.status = 404
  }
}

const lockBase64Monalisa =
  'ewogICAgInJlYXNvbiI6IG51bGwsCiAgICAiYnJhbmNoIjogImNvb2wtbmV3LWZlYXR1cmUiLAogICAgImNyZWF0ZWRfYXQiOiAiMjAyMi0wNi0xNVQyMToxMjoxNC4wNDFaIiwKICAgICJjcmVhdGVkX2J5IjogIm1vbmFsaXNhIiwKICAgICJzdGlja3kiOiBmYWxzZSwKICAgICJsaW5rIjogImh0dHBzOi8vZ2l0aHViLmNvbS90ZXN0LW9yZy90ZXN0LXJlcG8vcHVsbC8zI2lzc3VlY29tbWVudC0xMjMiCn0K'

const lockBase64Octocat =
  'ewogICAgInJlYXNvbiI6ICJUZXN0aW5nIG15IG5ldyBmZWF0dXJlIHdpdGggbG90cyBvZiBjYXRzIiwKICAgICJicmFuY2giOiAib2N0b2NhdHMtZXZlcnl3aGVyZSIsCiAgICAiY3JlYXRlZF9hdCI6ICIyMDIyLTA2LTE0VDIxOjEyOjE0LjA0MVoiLAogICAgImNyZWF0ZWRfYnkiOiAib2N0b2NhdCIsCiAgICAic3RpY2t5IjogdHJ1ZSwKICAgICJsaW5rIjogImh0dHBzOi8vZ2l0aHViLmNvbS90ZXN0LW9yZy90ZXN0LXJlcG8vcHVsbC8yI2lzc3VlY29tbWVudC00NTYiCn0K'

const saveStateMock = jest.spyOn(core, 'saveState')
const setFailedMock = jest.spyOn(core, 'setFailed')
const infoMock = jest.spyOn(core, 'info')

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(core, 'setFailed').mockImplementation(() => {})
  jest.spyOn(core, 'saveState').mockImplementation(() => {})
  jest.spyOn(core, 'info').mockImplementation(() => {})
})

const context = {
  actor: 'monalisa',
  repo: {
    owner: 'corp',
    repo: 'test'
  },
  issue: {
    number: 1
  },
  payload: {
    comment: {
      body: '.lock',
      id: 123
    }
  }
}

const ref = 'cool-new-feature'

test('successfully obtains a deployment lock (non-sticky) by creating the branch and lock file', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('Reference does not exist'))
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      git: {
        createRef: jest.fn().mockReturnValue({status: 201})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false)).toBe(true)
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: branch-deploy-lock'
  )
})

test('Determines that another user has the lock and exits', async () => {
  const actionStatusSpy = jest
    .spyOn(actionStatus, 'actionStatus')
    .mockImplementation(() => {
      return undefined
    })
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockReturnValue({data: {content: lockBase64Octocat}})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false)).toBe(false)
  expect(actionStatusSpy).toHaveBeenCalledWith(
    context,
    octokit,
    123,
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock has already been claimed/
    )
  )
  expect(saveStateMock).toHaveBeenCalledWith('bypass', 'true')
  expect(setFailedMock).toHaveBeenCalledWith(
    expect.stringMatching(
      /Sorry __monalisa__, the deployment lock has already been claimed/
    )
  )
})

test('Determines that the lock request is coming from current owner of the lock and exits', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockReturnValue({data: {content: lockBase64Monalisa}})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false)).toBe('owner')
  expect(infoMock).toHaveBeenCalledWith('monalisa is the owner of the lock')
})

test('Creates a lock when the lock branch exists but no lock file exists', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        getContent: jest
          .fn()
          .mockRejectedValue(new NotFoundError('file not found')),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, false)).toBe(true)
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file - with a --reason', async () => {
  const context = {
    actor: 'monalisa',
    repo: {
      owner: 'corp',
      repo: 'test'
    },
    issue: {
      number: 1
    },
    payload: {
      comment: {
        body: '.lock --reason testing a super cool new feature',
        id: 123
      }
    }
  }
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('Reference does not exist'))
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      git: {
        createRef: jest.fn().mockReturnValue({status: 201})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, true)).toBe(true)
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: branch-deploy-lock'
  )
})

test('successfully obtains a deployment lock (sticky) by creating the branch and lock file - with an empty --reason', async () => {
  const context = {
    actor: 'monalisa',
    repo: {
      owner: 'corp',
      repo: 'test'
    },
    issue: {
      number: 1
    },
    payload: {
      comment: {
        body: '.lock --reason ',
        id: 123
      }
    }
  }
  const octokit = {
    rest: {
      repos: {
        getBranch: jest
          .fn()
          .mockRejectedValueOnce(new NotFoundError('Reference does not exist'))
          .mockReturnValueOnce({data: {commit: {sha: 'abc123'}}}),
        get: jest.fn().mockReturnValue({data: {default_branch: 'main'}}),
        createOrUpdateFileContents: jest.fn().mockReturnValue({})
      },
      git: {
        createRef: jest.fn().mockReturnValue({status: 201})
      },
      issues: {
        createComment: jest.fn().mockReturnValue({})
      }
    }
  }
  expect(await lock(octokit, context, ref, 123, true)).toBe(true)
  expect(infoMock).toHaveBeenCalledWith('deployment lock obtained')
  expect(infoMock).toHaveBeenCalledWith('deployment lock is sticky')
  expect(infoMock).toHaveBeenCalledWith(
    'Created lock branch: branch-deploy-lock'
  )
})

test('throws an error if an unhandled exception occurs', async () => {
  const octokit = {
    rest: {
      repos: {
        getBranch: jest.fn().mockRejectedValueOnce(new Error('oh no')),
        getContent: jest.fn().mockRejectedValue(new Error('oh no'))
      }
    }
  }
  try {
    await lock(octokit, context, ref, 123, true)
  } catch (e) {
    expect(e.message).toBe('Error: oh no')
  }
})