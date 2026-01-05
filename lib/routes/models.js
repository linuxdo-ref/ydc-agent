/**
 * Models Route
 */

import { Router } from 'express';
import { authenticate } from '../auth-middleware.js';
import { listAdvancedVersions, getVersionInfo, getDefaultAdvancedVersion } from '../advanced-versions.js';

const router = Router();

// Parse custom agents from env
function getCustomAgents() {
  const raw = process.env.YDC_CUSTOM_AGENTS || '';
  if (!raw) return [];
  
  return raw.split(',').map(entry => {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    
    // Format: name:id or just id
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      return {
        name: trimmed.substring(0, colonIndex),
        id: trimmed.substring(colonIndex + 1)
      };
    }
    return { name: trimmed, id: trimmed };
  }).filter(Boolean);
}

router.get('/v1/models', authenticate, (req, res) => {
  const baseModels = [
    {
      id: 'advanced',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'you-com',
      permission: [],
      root: 'advanced',
      parent: null
    },
    {
      id: 'express',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'you-com',
      permission: [],
      root: 'express',
      parent: null
    },
    {
      id: 'research',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'you-com',
      permission: [],
      root: 'research',
      parent: null
    }
  ];

  // Add custom agents from env/CLI
  const customAgents = getCustomAgents();
  const customModels = customAgents.map(agent => ({
    id: agent.name,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'you-com',
    permission: [],
    root: 'custom',
    parent: null,
    agent_id: agent.id,
    description: `Custom agent${agent.name !== agent.id ? ` (${agent.id})` : ''}`
  }));

  const advancedVersionModels = listAdvancedVersions().map(version => {
    const versionInfo = getVersionInfo(version);
    return {
      id: version,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'you-com',
      permission: [],
      root: 'advanced',
      parent: 'advanced',
      description: versionInfo.description,
      tools: versionInfo.tools
    };
  });

  res.json({
    object: 'list',
    data: [...baseModels, ...customModels, ...advancedVersionModels]
  });
});

router.get('/v1/versions', authenticate, (req, res) => {
  const versions = listAdvancedVersions().map(version => getVersionInfo(version));
  res.json({
    object: 'list',
    data: versions,
    default_version: getDefaultAdvancedVersion(),
    temperature_mapping: {
      "0.0-0.5": "Uses medium verbosity versions with reduced workflow steps",
      "0.5-1.0": "Uses high verbosity versions with increased workflow steps"
    }
  });
});

export default router;
