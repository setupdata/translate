# Ruyi Translation

Ruyi Translation is a uTools plugin for user-initiated translation of text through a selected AI service.

## Language

**Translation task**:
A user-initiated request to convert source text into a target language using the current service configuration.
_Avoid_: Job, query

**Translation trigger**:
An explicit user action that starts a translation task, such as invoking a text-matching command or a configured shortcut.
_Avoid_: Clipboard listener, background detection

**Source text**:
The text submitted by the user for translation. It may contain paragraphs, Markdown, code blocks, links, or domain-specific terms whose structure should be preserved.
_Avoid_: Clipboard content, prompt

**Target language**:
The language requested for the translation result. It defaults to the user's saved preference and may be changed for an individual translation task.
_Avoid_: Output locale

**Default target language**:
The target language preselected for new translation tasks. Changing a task's target language does not change this saved preference.
_Avoid_: Permanent target, source language

**Translation result**:
The translated form of the source text, without explanations or unrelated commentary.
_Avoid_: Answer, AI response

**Current translation**:
The source text, translation result, and task-level choices currently shown in the plugin. It may be resumed after the plugin is hidden and reopened while the same process remains alive, but it is not a saved translation history.
_Avoid_: Translation history, draft

**Service configuration**:
A saved, reusable set of connection and model choices for one AI translation service. A user may keep multiple service configurations and switch between them.
_Avoid_: Provider, account

**Current service configuration**:
The service configuration used for new translation tasks until the user selects another one.
_Avoid_: Default provider, active account

**Additional translation requirements**:
Optional user-defined guidance about terminology, tone, names, or other translation preferences. It supplements the fixed translation rules and cannot replace them.
_Avoid_: Custom prompt, system prompt

**Thinking mode**:
A quick, task-level translation option for additional model reasoning before producing the translation result. In the first version it is available only for official DeepSeek service configurations.
_Avoid_: Reasoning model, deep thinking

**Standard mode**:
The default translation quality mode, using one translation stage followed by deterministic checks for terminology, protected content, and structure. A parallel-accelerated task may use one request per translation segment within that stage.
_Avoid_: Fast mode, basic translation

**Precision mode**:
An optional translation quality mode that adds domain analysis, independent review, and targeted revision to reduce identified risks at additional time and cost.
_Avoid_: Guaranteed translation, agent mode

**Termbase**:
A user-managed collection of domain terms, preferred translations, accepted variants, forbidden translations, and usage guidance. Only entries relevant to the source text are applied to a translation task.
_Avoid_: Translation memory, glossary prompt

**Domain profile**:
A reusable description of a professional field, document type, audience, style, linked termbases, and approved reference translations.
_Avoid_: Automatic industry, model persona

**Quality risk**:
A specific, explainable concern found in a translation result, such as a missing number, damaged placeholder, terminology conflict, omission, addition, or target-language mismatch. It signals a need for review rather than proving the translation wrong.
_Avoid_: Accuracy score, confidence percentage

**Parallel acceleration**:
An optional way to reduce waiting time for a translation task within the input limit by translating structure-aware segments concurrently and restoring them in source order.
_Avoid_: Batch API, unlimited long-document translation

**Translation segment**:
A structure-aligned portion of source text owned by one parallel translation request, with a stable source order and optional read-only neighboring context.
_Avoid_: Page, batch item

**Task term**:
A temporary source-term and preferred-translation pair that applies only to the current translation and takes precedence over persistent termbases.
_Avoid_: Saved term, translation memory

**Reference translation**:
A user-approved source-and-translation example associated with a domain profile and used selectively to guide similar translation tasks.
_Avoid_: Translation history, automatic memory
