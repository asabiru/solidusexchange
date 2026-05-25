<div class="solidus-agreement-card">
    <label class="solidus-agreement-check" for="{{ $id ?? 'userAgreement' }}">
        <input type="checkbox"
               class="form-check-input"
               id="{{ $id ?? 'userAgreement' }}"
               name="user_agreement"
               value="1"
               required
               {{ old('user_agreement') ? 'checked' : '' }}>
        <span>
            @lang('I confirm that I have read and accept the Terms of Use, Privacy Policy, AML/KYC policy and risk disclosure.')
            @lang('SolidChange acts as an intermediary platform; the assigned trader or partner executes the trade.')
            <a href="{{ route('terms-and-conditions') }}" target="_blank">@lang('Terms')</a>
            ·
            <a href="{{ route('privacy-policy') }}" target="_blank">@lang('Privacy')</a>
        </span>
    </label>
    @error('user_agreement')
    <span class="text-danger d-block mt-2">{{ $message }}</span>
    @enderror
</div>
