<div class="row">
    <div class="col-md-6 mb-3">
        <label class="form-label">@lang('Currency')</label>
        <select name="currency_code" class="form-select @error('currency_code') is-invalid @enderror">
            <option value="">@lang('Select currency')</option>
            @foreach($currencies as $currency)
                <option value="{{ $currency->code }}" {{ old('currency_code', $wallet->currency_code ?? null) === $currency->code ? 'selected' : '' }}>
                    {{ $currency->code }} - {{ $currency->name }}
                </option>
            @endforeach
        </select>
        @error('currency_code')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
    <div class="col-md-6 mb-3">
        <label class="form-label">@lang('Network')</label>
        <input type="text" name="network" value="{{ old('network', $wallet->network ?? null) }}" class="form-control @error('network') is-invalid @enderror" placeholder="TRC20 / ERC20 / BTC">
        @error('network')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
    <div class="col-12 mb-3">
        <label class="form-label">@lang('Wallet Address')</label>
        <input type="text" name="address" value="{{ old('address', $wallet->address ?? null) }}" class="form-control @error('address') is-invalid @enderror">
        @error('address')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
    <div class="col-md-6 mb-3">
        <label class="form-label">@lang('Label')</label>
        <input type="text" name="label" value="{{ old('label', $wallet->label ?? null) }}" class="form-control @error('label') is-invalid @enderror" placeholder="@lang('Primary USDT pool')">
        @error('label')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
    <div class="col-md-6 mb-3">
        <label class="form-label">@lang('Status')</label>
        <select name="status" class="form-select @error('status') is-invalid @enderror">
            <option value="1" {{ (string)old('status', isset($wallet) ? (int)$wallet->status : 1) === '1' ? 'selected' : '' }}>@lang('Active')</option>
            <option value="0" {{ (string)old('status', isset($wallet) ? (int)$wallet->status : 1) === '0' ? 'selected' : '' }}>@lang('Inactive')</option>
        </select>
        @error('status')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
    <div class="col-12 mb-3">
        <label class="form-label">@lang('Notes')</label>
        <textarea name="notes" rows="4" class="form-control @error('notes') is-invalid @enderror">{{ old('notes', $wallet->notes ?? null) }}</textarea>
        @error('notes')
        <span class="invalid-feedback d-block">{{ $message }}</span>
        @enderror
    </div>
</div>
