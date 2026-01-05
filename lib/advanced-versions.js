/**
 * Advanced Agent Version System
 * Provides specialized configurations for different use cases
 */

export const ADVANCED_VERSIONS = {
  'advanced-1.0-medium': {
    verbosity: 'medium',
    max_workflow_steps: 1,
    timeout: 120000,
    tools: []
  },
  'advanced-1.0-high': {
    verbosity: 'high',
    max_workflow_steps: 1,
    timeout: 120000,
    tools: []
  },
  'advanced-2.0-medium': {
    verbosity: 'medium',
    max_workflow_steps: 2,
    timeout: 180000,
    tools: []
  },
  'advanced-2.0-high': {
    verbosity: 'high',
    max_workflow_steps: 2,
    timeout: 180000,
    tools: []
  },
  'advanced-3.0-medium': {
    verbosity: 'medium',
    max_workflow_steps: 5,
    timeout: 180000,
    tools: [{ type: 'compute' }]
  },
  'advanced-3.0-high': {
    verbosity: 'high',
    max_workflow_steps: 5,
    timeout: 180000,
    tools: [{ type: 'compute' }]
  },
  'advanced-4.0-medium': {
    verbosity: 'medium',
    max_workflow_steps: 6,
    timeout: 180000,
    tools: [{ type: 'research', search_effort: 'medium', report_verbosity: 'medium' }]
  },
  'advanced-4.0-high': {
    verbosity: 'high',
    max_workflow_steps: 6,
    timeout: 180000,
    tools: [{ type: 'research', search_effort: 'high', report_verbosity: 'high' }]
  },
  'advanced-4.5-medium-research': {
    verbosity: 'medium',
    max_workflow_steps: 9,
    timeout: 300000,
    tools: [
      { type: 'compute' },
      { type: 'research', search_effort: 'medium', report_verbosity: 'medium' }
    ]
  },
  'advanced-4.5-high-research': {
    verbosity: 'high',
    max_workflow_steps: 9,
    timeout: 300000,
    tools: [
      { type: 'compute' },
      { type: 'research', search_effort: 'high', report_verbosity: 'high' }
    ]
  }
};

export function getAdvancedVersion(versionName) {
  return ADVANCED_VERSIONS[versionName] || null;
}

export function isAdvancedVersion(modelName) {
  return modelName in ADVANCED_VERSIONS;
}

export function getDefaultAdvancedVersion(temperature = 0.7) {
  return temperature <= 0.5 ? 'advanced-3.0-medium' : 'advanced-3.0-high';
}

export function adjustWorkflowSteps(baseSteps, temperature) {
  const adjustment = Math.round((temperature - 0.5) * 4);
  return Math.max(1, Math.min(20, baseSteps + adjustment));
}

export function listAdvancedVersions() {
  return Object.keys(ADVANCED_VERSIONS);
}

export function getVersionInfo(versionName) {
  const config = ADVANCED_VERSIONS[versionName];
  if (!config) return null;
  
  const toolNames = config.tools.map(t => {
    if (t.type === 'research') return `research(${t.search_effort})`;
    return t.type;
  }).join(', ') || 'none';

  return {
    name: versionName,
    verbosity: config.verbosity,
    max_workflow_steps: config.max_workflow_steps,
    timeout_seconds: config.timeout / 1000,
    tools: toolNames,
    description: `${config.verbosity} verbosity, ${config.max_workflow_steps} steps, ${config.timeout/1000}s timeout`
  };
}
