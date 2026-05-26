<!-- Coin Announce Modal Start-->
<div class="modal fade announcement-modal" id="exampleModal" tabindex="-1" aria-labelledby="exampleModalLabel"
     aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header border-0 p-3 pb-0 justify-content-end">

                <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close"><i
                        class="fa-regular fa-xmark"></i></button>
            </div>
            <div class="modal-body text-center" id="announceBodyShow">

            </div>
        </div>
    </div>
</div>
<!-- Coin Announce Modal End -->

<!-- Modal section start -->
<div class="modal fade calculator-modal" id="calculator-modal" data-bs-backdrop="static" data-bs-keyboard="false"
     tabindex="-1" aria-labelledby="staticBackdropLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header flex-column">
                <div class="d-flex justify-content-between align-items-center">
                    <h3 class="modal-title" id="staticBackdropLabel">@lang('Select a currency')</h3>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="search-box mt-10">
                    <input type="text" id="search-input" onkeyup="filterItems('search-input')" class="form-control"
                           placeholder="@lang('Search here')...">
                    <button type="submit" class="search-btn"><i class="far fa-search"></i></button>
                </div>
            </div>
            <div class="modal-body">
                <div id="currency-list" class="currency-list">
                    <div id="show-send">

                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="modal fade calculator-modal" id="calculator-modal2" data-bs-backdrop="static" data-bs-keyboard="false"
     tabindex="-1" aria-labelledby="staticBackdropLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header flex-column">
                <div class="d-flex justify-content-between align-items-center">
                    <h3 class="modal-title" id="staticBackdropLabel">Select a currency</h3>
                    <button type="button" class="cmn-btn-close" data-bs-dismiss="modal" aria-label="Close">
                        <i class="fa-light fa-xmark"></i>
                    </button>
                </div>
                <div class="search-box mt-10">
                    <input type="text" id="search-input2" onkeyup="filterItems2('search-input2')" class="form-control"
                           placeholder="Search here...">
                    <button type="submit" class="search-btn"><i class="far fa-search"></i></button>
                </div>
            </div>
            <div class="modal-body">
                <div id="currency-list2" class="currency-list">
                    <div id="show-get">

                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<!-- Modal section end -->
