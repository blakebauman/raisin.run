import type { CrawlConfig } from '@raisin/core';
import { Input } from '@raisin/ui/input';
import { NativeSelect, NativeSelectOption } from '@raisin/ui/native-select';
import { Textarea } from '@raisin/ui/textarea';
import { useState } from 'react';
import { presetFor, TOGGLES, USER_AGENTS } from '~/lib/config-form';
import { CheckField, Field } from './common';

type Capabilities = {
  rendering: boolean;
  ai: boolean;
  verified: boolean;
  maxUrls: number;
  maxRate: number;
};

/** The crawl configuration fields. Rendered inside a parent <Form>. */
export function CrawlConfigFields({ config, caps }: { config: CrawlConfig; caps: Capabilities }) {
  const [preset, setPreset] = useState(presetFor(config.userAgent));
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Field
          id="maxUrls"
          label="URL limit"
          hint={`Up to ${caps.maxUrls.toLocaleString()}${caps.verified ? '' : ' until verified'}.`}
        >
          <Input
            id="maxUrls"
            name="maxUrls"
            type="number"
            min={1}
            max={caps.maxUrls}
            defaultValue={Math.min(config.maxUrls, caps.maxUrls)}
          />
        </Field>
        <Field id="maxDepth" label="Max crawl depth">
          <Input
            id="maxDepth"
            name="maxDepth"
            type="number"
            min={0}
            max={50}
            defaultValue={config.maxDepth}
          />
        </Field>
        <Field
          id="maxUrlsPerSecond"
          label="Speed (URLs/second)"
          hint={`Up to ${caps.maxRate}${caps.verified ? '' : ' until verified'}.`}
        >
          <Input
            id="maxUrlsPerSecond"
            name="maxUrlsPerSecond"
            type="number"
            min={0.2}
            step={0.1}
            max={caps.maxRate}
            defaultValue={Math.min(config.maxUrlsPerSecond, caps.maxRate)}
          />
        </Field>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="userAgentPreset" label="User agent">
          <NativeSelect
            id="userAgentPreset"
            name="userAgentPreset"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full"
          >
            {Object.entries(USER_AGENTS).map(([key, ua]) => (
              <NativeSelectOption key={key} value={key}>
                {ua.label}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="custom">Custom…</NativeSelectOption>
          </NativeSelect>
        </Field>
        {preset === 'custom' && (
          <Field id="userAgent" label="Custom user agent">
            <Input id="userAgent" name="userAgent" defaultValue={config.userAgent} />
          </Field>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium">Spider</h3>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {TOGGLES.map((t) => (
            <CheckField
              key={t.key}
              id={t.key}
              name={t.key}
              label={t.label}
              hint={t.hint}
              defaultChecked={Boolean(config[t.key])}
              disabled={t.key === 'respectRobots' && !caps.verified}
            />
          ))}
        </div>
        {/* A disabled checkbox doesn't submit; keep robots.txt on for unverified domains. */}
        {!caps.verified && <input type="hidden" name="respectRobots" value="on" />}
      </section>

      <section>
        <h3 className="text-sm font-medium">JavaScript rendering and AI</h3>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
          <CheckField
            id="renderEnabled"
            name="renderEnabled"
            label="Render pages in headless Chrome"
            hint={
              caps.rendering
                ? 'Slower; compares raw and rendered HTML.'
                : 'Available on Pro and Agency plans.'
            }
            defaultChecked={config.render.enabled}
            disabled={!caps.rendering}
          />
          <CheckField
            id="screenshots"
            name="screenshots"
            label="Capture screenshots"
            defaultChecked={config.render.screenshots}
            disabled={!caps.rendering}
          />
          <CheckField
            id="aiSimilarity"
            name="aiSimilarity"
            label="Find semantically similar pages (AI)"
            hint={
              caps.ai
                ? 'Embeds page text to find pages competing for the same intent.'
                : 'Available on Pro and Agency plans.'
            }
            defaultChecked={config.ai.nearDuplicates}
            disabled={!caps.ai}
          />
          <Field id="waitUntil" label="Render wait condition">
            <NativeSelect
              id="waitUntil"
              name="waitUntil"
              defaultValue={config.render.waitUntil}
              disabled={!caps.rendering}
              className="w-full"
            >
              <NativeSelectOption value="networkidle0">Network idle</NativeSelectOption>
              <NativeSelectOption value="networkidle2">Network almost idle</NativeSelectOption>
              <NativeSelectOption value="load">Load event</NativeSelectOption>
              <NativeSelectOption value="domcontentloaded">DOM content loaded</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field
          id="include"
          label="Include (regex, one per line)"
          hint="Only crawl URLs matching at least one pattern."
        >
          <Textarea
            id="include"
            name="include"
            rows={3}
            defaultValue={config.include.join('\n')}
            placeholder="/blog/"
          />
        </Field>
        <Field id="exclude" label="Exclude (regex, one per line)">
          <Textarea
            id="exclude"
            name="exclude"
            rows={3}
            defaultValue={config.exclude.join('\n')}
            placeholder="\?sort="
          />
        </Field>
        <Field
          id="extractors"
          label="Custom extraction"
          hint="One per line: name | css or regex | selector | attribute (optional)."
        >
          <Textarea
            id="extractors"
            name="extractors"
            rows={3}
            defaultValue={config.extractors
              .map((e) => [e.name, e.kind, e.selector, e.attribute].filter(Boolean).join(' | '))
              .join('\n')}
            placeholder={'price | css | .price\nsku | regex | "sku":"([^"]+)"'}
          />
        </Field>
        <Field id="customHeaders" label="Request headers" hint="One per line: Name: value">
          <Textarea
            id="customHeaders"
            name="customHeaders"
            rows={3}
            defaultValue={Object.entries(config.customHeaders)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}
            placeholder="Authorization: Basic …"
          />
        </Field>
      </section>
    </div>
  );
}
