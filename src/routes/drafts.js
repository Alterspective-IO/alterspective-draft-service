import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { createDraft } from '../services/GraphService.js';
import { renderTemplate } from '../services/TemplateService.js';

const router = Router();

const API_KEY = process.env.API_KEY;

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const validateDraft = [
  body('userEmail').isEmail().withMessage('userEmail must be a valid email'),
];

/**
 * POST /v1/drafts
 *
 * Template mode: { userEmail, templateName, mergeFields }
 * Direct mode:   { userEmail, subject, body, toRecipients }
 *
 * Returns: { id, webLink }
 */
router.post('/', requireApiKey, validateDraft, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { userEmail, templateName, mergeFields, subject, body: directBody, toRecipients } = req.body;

  try {
    let draft;
    if (templateName) {
      const rendered = renderTemplate(templateName, mergeFields || {});
      draft = await createDraft(userEmail, rendered);
    } else if (subject) {
      draft = await createDraft(userEmail, {
        subject,
        body: directBody || '',
        toRecipients: toRecipients || [],
      });
    } else {
      return res.status(400).json({ error: 'Provide templateName or subject' });
    }
    res.status(201).json(draft);
  } catch (err) {
    console.error('Draft creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
