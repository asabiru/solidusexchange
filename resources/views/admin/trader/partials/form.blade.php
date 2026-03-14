<div class="row">
    <div class="col-lg-8">
        <div class="card mb-4">
            <div class="card-header">
                <h4 class="card-title mb-0">@lang('Trader Profile')</h4>
            </div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label">@lang('Name')</label>
                        <input type="text" name="name" class="form-control" value="{{ old('name', $trader->name ?? '') }}">
                        @error('name')
                        <span class="invalid-feedback d-block">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">@lang('Username')</label>
                        <input type="text" name="username" class="form-control" value="{{ old('username', $trader->username ?? '') }}">
                        @error('username')
                        <span class="invalid-feedback d-block">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">@lang('Email')</label>
                        <input type="email" name="email" class="form-control" value="{{ old('email', $trader->email ?? '') }}">
                        @error('email')
                        <span class="invalid-feedback d-block">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">@lang('Telegram Username')</label>
                        <input type="text" name="telegram_username" class="form-control"
                               placeholder="@username"
                               value="{{ old('telegram_username', $trader->telegram_display ?? '') }}">
                        <small class="text-body">@lang('Enter trader Telegram nickname starting with @.')</small>
                        @error('telegram_username')
                        <span class="invalid-feedback d-block">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">@lang('Password')</label>
                        <input type="password" name="password" class="form-control">
                        @if(isset($trader))
                            <small class="text-body">@lang('Leave empty to keep the current password.')</small>
                        @endif
                        @error('password')
                        <span class="invalid-feedback d-block">{{ $message }}</span>
                        @enderror
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">@lang('Confirm Password')</label>
                        <input type="password" name="password_confirmation" class="form-control">
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div class="col-lg-4">
        <div class="card mb-4">
            <div class="card-header">
                <h4 class="card-title mb-0">@lang('Status')</h4>
            </div>
            <div class="card-body">
                <div class="form-check form-switch mb-3">
                    <input type="hidden" name="status" value="0">
                    <input class="form-check-input" type="checkbox" id="traderStatus" name="status" value="1"
                           {{ (string) old('status', $trader->status ?? '1') === '1' ? 'checked' : '' }}>
                    <label class="form-check-label" for="traderStatus">@lang('Trader is active')</label>
                </div>
                <p class="text-body mb-0">@lang('Active traders can receive manual sell requests when they are online.')</p>
            </div>
        </div>
        <div class="d-flex justify-content-start">
            <button type="submit" class="btn btn-primary">{{ $submitLabel }}</button>
        </div>
    </div>
</div>
