<div class="modal fade" id="delete" data-bs-backdrop="static" tabindex="-1" role="dialog"
     aria-labelledby="staticBackdropLabel" aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="deleteModalHeader">@lang('Delete Confirmation!')</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                <p id="deleteModalBody">@lang('Are you certain you want to proceed with the deletion?')</p>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                <form action="" method="post" class="deleteModalRoute">
                    @csrf
                    @method('delete')
                    <button type="submit" class="btn btn-soft-danger">@lang('Yes')</button>
                </form>
            </div>
        </div>
    </div>
</div>
<!-- Modal -->
<div class="modal fade" id="MultipleDelete" tabindex="-1" role="dialog" aria-labelledby="MultipleDelete"
     data-bs-backdrop="static"
     aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="userDeleteMultipleModalLabel"><i
                        class="fa-light fa-square-check"></i> @lang('Confirmation')</h3>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <form action="" method="post">
                @csrf
                <div class="modal-body">
                    @lang('Would you like to delete the entirety of the selected data?')
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <button type="submit" class="btn btn-primary delete-multiple">@lang('Confirm')</button>
                </div>
            </form>
        </div>
    </div>
</div>
<!-- End Modal -->

<!-- Modal -->
<div class="modal fade" id="MultipleStatusChange" tabindex="-1" role="dialog" aria-labelledby="MultipleStatusChange"
     data-bs-backdrop="static"
     aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="userStatusMultipleModalLabel"><i
                        class="fa-light fa-square-check"></i> @lang('Confirmation')</h3>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <form action="" method="post">
                @csrf
                <div class="modal-body">
                    @lang('Are you looking to update the status for all the selected data?')
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <button type="submit" class="btn btn-primary change-multiple">@lang('Yes')</button>
                </div>
            </form>
        </div>
    </div>
</div>
<!-- End Modal -->

<!-- Modal -->
<div class="modal fade" id="MultipleRateUpdate" tabindex="-1" role="dialog" aria-labelledby="MultipleRateUpdate"
     data-bs-backdrop="static"
     aria-hidden="true">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="userRateMultipleModalLabel"><i
                        class="fa-light fa-square-check"></i> @lang('Confirmation')</h3>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <form action="" method="post">
                @csrf
                <div class="modal-body" id="currencyRate">
                    @lang('Would you like to apply the updated rate to all the selected data?')
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-white" data-bs-dismiss="modal">@lang('Close')</button>
                    <button type="submit" class="btn btn-primary rate-multiple">@lang('Yes')</button>
                </div>
            </form>
        </div>
    </div>
</div>
<!-- End Modal -->
