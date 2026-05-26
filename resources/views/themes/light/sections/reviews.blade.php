@php
    $testimonialSingle = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'testimonial')->where('type', 'single'))
        ->where('language_id', app()->getLocale() !== config('app.locale') ? 2 : 1)
        ->first();
    $testimonialSingle = $testimonialSingle ?? \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'testimonial')->where('type', 'single'))
        ->first();

    $testimonialMultiple = \App\Models\ContentDetails::with('content')
        ->whereHas('content', fn($q) => $q->where('name', 'testimonial')->where('type', 'multiple'))
        ->where('language_id', 1)
        ->get();

    $sectionTitle = $testimonialSingle ? __($testimonialSingle->description->title ?? 'Отзывы') : 'Отзывы';
    $sectionSubtitle = $testimonialSingle ? __($testimonialSingle->description->sub_title ?? 'Что говорят наши клиенты') : 'Что говорят наши клиенты';
@endphp

<!-- Reviews Section - eazy228/design style -->
<section class="reviews-section" id="reviews">
    <div class="container">
        <div class="reviews-header">
            <span class="section-number">08 /</span>
            <h2 class="section-title">{{ $sectionTitle }}</h2>
        </div>

        <h3 class="reviews-subtitle">{{ $sectionSubtitle }}</h3>

        <div class="reviews-grid">
            @if($testimonialMultiple->isEmpty())
            <div class="review-card">
                <p class="review-text" style="text-align:center; opacity:0.5;">Отзывы пока не добавлены. Добавьте их через админку → Управление контентом → Testimonial.</p>
            </div>
            @else
            @foreach($testimonialMultiple as $item)
            @php
                $desc = is_object($item->description) ? (array) $item->description : $item->description;
                $name = $desc['name'] ?? 'Клиент';
                $address = $desc['address'] ?? '';
                $star = (int)($desc['star'] ?? 5);
                $description = __($desc['description'] ?? '');
                $imagePath = isset($item->content->media->image) ? getFile($item->content->media->image->driver ?? '', $item->content->media->image->path ?? '') : null;
                $initials = mb_strtoupper(mb_substr($name, 0, 1) . mb_substr(explode(' ', $name)[1] ?? $name, 0, 1));
            @endphp
            <div class="review-card">
                <div class="review-rating">
                    @for($i = 0; $i < 5; $i++)
                        @if($i < $star)
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        @else
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        @endif
                    @endfor
                </div>
                <p class="review-text">{{ $description }}</p>
                <div class="review-author">
                    @if($imagePath)
                    <div class="author-avatar"><img src="{{ $imagePath }}" alt="{{ $name }}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;"></div>
                    @else
                    <div class="author-avatar">{{ $initials }}</div>
                    @endif
                    <div class="author-info">
                        <span class="author-name">{{ $name }}</span>
                        <span class="author-date">{{ $address }}</span>
                    </div>
                </div>
            </div>
            @endforeach
            @endif
        </div>
    </div>
</section>