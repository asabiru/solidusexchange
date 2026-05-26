@if ($paginator->hasPages())
    <div class="pagination-section">
        <nav aria-label="...">
            <ul class="pagination">
                {{-- Previous Page Link --}}
                @if ($paginator->onFirstPage())
                    <li class="disabled page-item">
                        <a href="#" class="page-link">
                            <i class="fal fa-long-arrow-left"></i>
                        </a>
                    </li>
                @else
                    <li class="page-item">
                        <a href="{{ $paginator->previousPageUrl() }}" class="page-link"><i
                                class="fal fa-long-arrow-left"></i></a>
                    </li>
                @endif

                {{-- Pagination Elements --}}
                @foreach ($elements as $element)
                    {{-- "Three Dots" Separator --}}
                    @if (is_string($element))
                        <li class="page-item">
                            <a href="#" class="page-link">{{ $element }}</a>
                        </li>
                    @endif

                    {{-- Array Of Links --}}
                    @if (is_array($element))
                        @foreach ($element as $page => $url)
                            @if ($page == $paginator->currentPage())
                                <li class="page-item active">
                                    <a href="#" class="page-link">{{ $page }}<span class="sr-only">(current)</span></a>
                                </li>
                            @else
                                <li class="page-item">
                                    <a href="{{ $url}}" class="page-link">{{ $page }}</a>
                                </li>
                            @endif
                        @endforeach
                    @endif
                @endforeach

                {{-- Next Page Link --}}
                @if ($paginator->hasMorePages())
                    <li class="page-item">
                        <a href="{{ $paginator->nextPageUrl() }}" class="page-link"><i
                                class="fal fa-long-arrow-right"></i></a>
                    </li>
                @else
                    <li class="disabled page-item">
                        <a href="#" class="disabled page-link">
                            <i class="fal fa-long-arrow-right"></i>
                        </a>
                    </li>
                @endif
            </ul>
        </nav>
    </div>
@endif
