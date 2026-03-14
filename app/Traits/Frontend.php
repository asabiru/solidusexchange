<?php

namespace App\Traits;

use App\Models\Blog;
use App\Models\ContentDetails;
use App\Models\Language;

trait Frontend
{
    protected function getSectionsData($sections, $content, $selectedTheme, $preferredLanguageId = null, $fallbackLanguageId = null)
    {
        if ($sections == null) {
            $data = ['support' => $content,];
            return view("themes.$selectedTheme.support", $data)->toHtml();
        }

        $languageIds = collect([$preferredLanguageId, $fallbackLanguageId])
            ->filter()
            ->unique()
            ->values()
            ->all();

        $contentQuery = ContentDetails::withoutGlobalScope('language')
            ->with('content')
            ->whereHas('content', function ($query) use ($sections) {
                $query->whereIn('name', $sections);
            });

        if (!empty($languageIds)) {
            $contentQuery->whereIn('language_id', $languageIds);
        }

        $contentData = $contentQuery->get()
            ->groupBy('content_id')
            ->map(function ($items) use ($preferredLanguageId, $fallbackLanguageId) {
                return $items->sortBy(function ($item) use ($preferredLanguageId, $fallbackLanguageId) {
                    if ($preferredLanguageId && (int) $item->language_id === (int) $preferredLanguageId) {
                        return 0;
                    }

                    if ($fallbackLanguageId && (int) $item->language_id === (int) $fallbackLanguageId) {
                        return 1;
                    }

                    return 2;
                })->first();
            })
            ->filter()
            ->values();


        foreach ($sections as $section) {
            $singleContent = $contentData->where('content.name', $section)->where('content.type', 'single')->first() ?? [];
            $multipleContents = $contentData->where('content.name', $section)->where('content.type', 'multiple')->values()->map(function ($multipleContentData) {
                return collect($multipleContentData->description)->merge($multipleContentData->content->only('media'))->merge(['id' => $multipleContentData->id, 'created_at' => $multipleContentData->created_at]);
            });

            $data[$section] = [
                'single' => $singleContent ? collect($singleContent->description ?? [])->merge($singleContent->content->only('media')) : [],
                'multiple' => $multipleContents,
                'mediaFile' => isset($singleContent->content->media->image->driver) ? getFile($singleContent->content->media->image->driver, $singleContent->content->media->image->path) : null,
            ];

            $replacement = view("themes.$selectedTheme.sections.{$section}", $data)->toHtml();
            $escapedSection = preg_quote($section, '/');
            $customBlockPattern = '/<div class="custom-block" contenteditable="false">\s*<div class="custom-block-content">\[\[' . $escapedSection . '\]\]<\/div>\s*(?:<span class="(?:delete|up|down)-block">.*?<\/span>\s*)*<\/div>/su';

            $content = preg_replace($customBlockPattern, $replacement, $content, 1);

            $content = str_replace('<div class="custom-block" contenteditable="false"><div class="custom-block-content">[[' . $section . ']]</div>', $replacement, $content);
            $content = preg_replace('/<span class="(?:delete|up|down)-block">.*?<\/span>/su', '', $content);
            $content = str_replace('<p><br></p>', '', $content);
        }

        return $content;
    }
}
