<div style="max-width: 600px; margin: 50px auto;">
    <a href="">
        <img style="max-width: 130px; min-width: 100px;" src="{{$logo}}" alt="">
    </a>
    <div style="margin: 30px 0; border: 1px solid #f2f2f2; padding: 30px; border-radius: 3px;">
        <h4 style="margin-bottom: 30px; font-family: 'Prompt', sans-serif; font-weight: 400;">{{$emailMessage}}</h4>
        <p style="margin: 30px 0;">
            The request was
            initiated by <a href=""
                            style="color: #3368fa; text-decoration: underline;">{{$emailAddress}}</a> on {{$date}}.
        </p>

        @if($url)
            <div style="display: flex; justify-content: center;">
                <a href="{{$url}}"
                   style="background-color: #3368fa; color: #ffffff; text-decoration: none; padding: 7px 20px; border-radius: 15px; border: 1px solid #3368fa; text-transform: capitalize;">{{$urlName}}</a>
            </div>
        @endif

    </div>
    <div style="text-align: center; margin-top: 30px;">
        <a href="">
            <img style="max-width: 100px; min-width: 100px;" src="{{$logo}}" alt="">
        </a>
    </div>
</div>
