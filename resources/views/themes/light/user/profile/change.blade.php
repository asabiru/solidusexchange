@extends($theme.'layouts.user')
@section('page_title',__('Change Password'))

@section('content')
	<div class="section dashboard">
		<div class="row">
			@include($theme.'user.profile.profileNav')
			<form action="{{ route('user.change.password') }}" method="post">
				@csrf
				<div class="account-settings-profile-section">
					<div class="card">
						<div class="card-header">
							<h5 class="card-title">@lang('Update Password')
							</h5>
							<div class="card-body pt-0">
								<div class="profile-form-section">
									<div class="row g-3">
										<div class="col-md-12">
											<div class="form-group">
												<label for="currentPassword"
													   class="col-form-label">@lang('Current password')</label>
												<input type="password" name="currentPassword"
													   value="{{ old('currentPassword') }}"
													   placeholder="@lang('Enter your current password')"
													   class="form-control @error('currentPassword') is-invalid @enderror">
												<div
													class="invalid-feedback">@error('currentPassword') @lang($message) @enderror</div>
											</div>
										</div>
										<div class="col-md-12">
											<div class="form-group">
												<label for="password"
													   class="col-form-label">@lang('Password')</label>
												<input type="password" name="password" value="{{ old('password') }}"
													   placeholder="@lang('Enter new password')"
													   class="form-control @error('password') is-invalid @enderror">
												<div
													class="invalid-feedback">@error('password') @lang($message) @enderror</div>
											</div>
										</div>
										<div class="col-md-12">
											<div class="form-group">
												<label for="password_confirmation"
													   class="col-form-label">@lang('Repeat password')</label>
												<input type="password" name="password_confirmation"
													   value="{{ old('password_confirmation') }}"
													   class="form-control form-control-sm"
													   placeholder="@lang('Repeat password')">
											</div>
										</div>
										<div class="btn-area d-flex g-3">
											<button type="submit"
													class="cmn-btn">@lang('Change Password')</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</form>
		</div>
	</div>
@endsection
